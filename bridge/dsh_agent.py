# -*- coding: utf-8 -*-
"""把「动手」类委托交给 DSH headless 真正执行。

设计要点：
- **默认只读**：只有任务里明确要改文件才升级到 workspace-write。
- **超时清理整棵进程树**：不留孤儿。
- **并发/每日上限可配**：`config.delegation.maxConcurrent / maxPerDay`。
- **任务落盘**：重启后能发现「上一个还没跑完就被打断」的委托，主动告诉主人。
- **能力闸门**：发微信/发图这类执行端做不到的事，提前拒绝并给正确做法。
- API key 从 data/settings.json 读，只进子进程环境变量：不打印、不落日志。
"""
import json
import os
import re
import subprocess
import threading
import time
import uuid

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
EXE = r"C:\Users\28030\AppData\Local\Programs\DeepSeek Harness\DeepSeek Harness.exe"
BIN = (r"C:\Users\28030\AppData\Local\Programs\DeepSeek Harness\resources\app.asar"
       r"\dsh\node_modules\@deepseek-ai\dsh\lib\bin.js")
DEFAULT_CWD = r"D:\dsh\profiles\desktop"
DEFAULT_TIMEOUT = 150
MAX_CHARS = 4000

JOBS_FILE = os.path.join(ROOT, "data", "delegation-jobs.json")
MAX_JOB_HISTORY = 200

PREFIXES = ('动手：', '动手:', '@动手 ', '/dsh ', '@dsh ')

# 模型偶尔会把标记生成到一半（没有结尾的 ]]），所以闭合括号可选：
# 不这样的话 [[dsh:任务 会被当成正文原样发给主人（2026-11-22 踩过）
MARKER_RE = re.compile(r"\[\[dsh:\s*(.+?)(?:\]\]|$)", re.S)
FALLBACK_RE = re.compile(r"(?:交给|让)\s*dsh[^\n：:]{0,8}[：:]\s*([^\n。]+)")

WRITE_HINTS = ("改", "写", "创建", "新建", "删除", "删掉", "重命名", "移动", "替换",
               "保存到", "生成文件", "修改", "patch", "写入", "覆盖",
               # 「装」以前不认：安装类任务被判成只读，写应用目录必然失败（2026-11-22）
               "安装", "部署")

# 执行端做不到的事（它发不了微信、也没有搜图发图能力）
# 不要用「发个」这种宽词——「发个报告」「发个文件」是正常任务，会被误拦。
CANNOT_HINTS = ("发微信", "发到聊天", "发到微信", "回我微信",
                "搜图", "找图", "搜一张", "找一张", "来一张", "下载图片", "存表情包")

# 能力边界：这些是执行端**结构上做不到**的（没有 GUI、不能碰账号），
# 在派活前就拦下并说明，别让它跑一轮再回来说「权限被挡」。
# 每条 = (正则, 给主人的说明)。说明必须带上「那我该怎么办」。
CANNOT_RULES = [
    (r"(微信|wechat|QQ)[^。\n]{0,10}(界面|窗口|设置|选项|开关|扫一扫|三条杠)",
     "这活要操作聊天软件的界面对吧？我只能读写文件、跑命令，没有图形界面控制能力，点不了。"
     "你手动点两下就好；要是想让我看哪个配置文件，把路径发我。"),
    (r"(麦克风|摄像头|扬声器|声音|音量)[^。\n]{0,10}(开关|设置|权限|选项)",
     "麦克风这类开关在系统设置界面里，我没法点。你在 Windows 设置里开一下；"
     "或者把设置导出的文件给我，我帮你找对应项。"),
    (r"(看看|看一下|瞧一眼)[^。\n]{0,6}(屏幕|界面|桌面)|(截图|录屏|屏幕录制)",
     "我看不到屏幕，也没法截图。你截一张发我，我来读。"),
    (r"(点|点击|双击|右键|拖动|滑到)[^。\n]{0,6}(按钮|菜单|图标|窗口|选项|标签)",
     "我没法操作鼠标去点界面。把这件事换成「改哪个文件 / 跑哪条命令」，我就能做。"),
    (r"(扫码|二维码|验证码|人脸|指纹)[^。\n]{0,8}(登录|验证|认证)|(登录|登陆)[^。\n]{0,6}(微信|账号|后台)",
     "账号相关的操作（扫码、验证码、登录）必须你本人来，我不能碰。"),
    (r"(在)?(浏览器|网页)[^。\n]{0,8}(点|填|登录|操作)[^。\n]{0,6}(按钮|表单|后台)",
     "我没法在浏览器里点按钮填表单。给我网址我可以直接取数据；要提交就得你自己来。"),
]
CANNOT_RE = re.compile(r"(?:发|来)(?:我|给我)?(?:一|1)?(?:张|个)?[^。！？\n]{0,8}?(?:图|图片|表情包|表情)")

_lock = threading.Lock()
_state = {"running": 0, "ids": [], "procs": {}, "cancelled": set()}


# ------------------------------------------------------------------ 配置
def config():
    """委托相关配置，缺省值兜底。每次现读，改 config.json 立即生效。"""
    out = {"maxConcurrent": 1, "maxPerDay": 30, "timeout": DEFAULT_TIMEOUT, "readOnly": True}
    try:
        with open(os.path.join(ROOT, "data", "config.json"), encoding="utf-8-sig") as f:
            cfg = json.load(f)
        d = cfg.get("delegation") or {}
        out["maxConcurrent"] = max(1, int(d.get("maxConcurrent") or 1))
        out["maxPerDay"] = max(0, int(d.get("maxPerDay") if d.get("maxPerDay") is not None else 30))
        out["timeout"] = max(10, int(d.get("timeout") or DEFAULT_TIMEOUT))
        out["readOnly"] = bool(d.get("readOnly", True))
        # 这几个以前没透传：配置改了不生效（stall/首次提示/自适应超时都会失灵）
        for _k in ("adaptiveTimeout", "smallSeconds", "mediumSeconds",
                   "stallMinutes", "firstNudgeSeconds"):
            if d.get(_k) is not None:
                out[_k] = d.get(_k)
        out.setdefault("adaptiveTimeout", True)
    except Exception:
        pass
    return out


# ------------------------------------------------------------------ 任务落盘
def _load_jobs():
    try:
        with open(JOBS_FILE, encoding="utf-8") as f:
            d = json.load(f)
        return d if isinstance(d, list) else []
    except Exception:
        return []


def _save_jobs(jobs):
    try:
        tmp = JOBS_FILE + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(jobs[-MAX_JOB_HISTORY:], f, ensure_ascii=False, indent=1)
        os.replace(tmp, JOBS_FILE)
    except Exception:
        pass


def _today_prefix():
    return time.strftime("%Y-%m-%d")


def jobs_today():
    p = _today_prefix()
    return [j for j in _load_jobs() if str(j.get("started_at") or "").startswith(p)]


def begin_job(task, chat='', sender=''):
    job = {"id": uuid.uuid4().hex[:12], "task": str(task)[:200],
           "chat": chat, "sender": sender,
           # 自测/调试调用不带 chat，标成 test：恢复时不要把它当成主人的委托报出来
           "test": not bool(chat),
           "started_at": time.strftime("%Y-%m-%d %H:%M:%S"),
           "status": "running", "ts": time.time()}
    with _lock:
        jobs = _load_jobs()
        jobs.append(job)
        _save_jobs(jobs)
    return job["id"]


def finish_job(job_id, ok, text=''):
    with _lock:
        jobs = _load_jobs()
        for j in jobs:
            if j.get("id") == job_id:
                j["status"] = "done" if ok else "failed"
                j["ok"] = bool(ok)
                j["chars"] = len(str(text or ""))
                j["finished_at"] = time.strftime("%Y-%m-%d %H:%M:%S")
                j["elapsed"] = round(time.time() - float(j.get("ts") or time.time()), 1)
                break
        _save_jobs(jobs)


def take_interrupted():
    """启动时调用：把上次断电/重启时还在跑的委托标成中断，返回它们。"""
    out = []
    with _lock:
        jobs = _load_jobs()
        changed = False
        for j in jobs:
            if j.get("status") == "running" and not j.get("test"):
                j["status"] = "interrupted"
                j["finished_at"] = time.strftime("%Y-%m-%d %H:%M:%S")
                out.append(j)
                changed = True
        if changed:
            _save_jobs(jobs)
    return out


# ------------------------------------------------------------------ 文本解析
def extract_marker(text):
    """抽出回复里的 [[dsh:任务]] 或「交给 dsh：任务」，返回 (清理后的文本, 任务串)。"""
    s = str(text or "")
    tasks = [m.group(1).strip() for m in MARKER_RE.finditer(s) if m.group(1).strip()]
    if tasks and "]]" not in s and "[[dsh:" in s:
        try:
            import engine as _G
            _G.log('[!] 回复里的 [[dsh: 没有闭合，仍按任务处理并剥掉')
        except Exception:
            pass
    clean = MARKER_RE.sub("", s)
    for m in FALLBACK_RE.finditer(clean):
        t = m.group(1).strip(" ，,、：:")
        if t:
            tasks.append(t)
    clean = FALLBACK_RE.sub("", clean)
    clean = re.sub(r"[，,、]\s*[。！？!?]", "。", clean)
    clean = re.sub(r"[ \t]+\n", "\n", clean)
    clean = re.sub(r"\n{3,}", "\n\n", clean).strip()
    if tasks and len(clean) < 6:
        clean = "好，我去弄。"
    return clean, "；".join(dict.fromkeys(tasks))


def parse_task(text):
    """是委托就返回任务正文，否则返回空串。"""
    t = str(text or '').strip()
    for p in PREFIXES:
        if t.startswith(p):
            return t[len(p):].strip()
    return ''


def _api_key():
    try:
        with open(os.path.join(ROOT, "data", "settings.json"), encoding="utf-8-sig") as f:
            st = json.load(f)
        return str(st.get("apiKey") or (st.get("keys") or {}).get("deepseek") or "")
    except Exception:
        return ""


def available():
    asar = EXE.replace('DeepSeek Harness.exe', '') + 'resources\\app.asar'
    return bool(_api_key()) and os.path.isfile(EXE) and os.path.isfile(asar)


HANDS = (
    "你是「鲸鲸」的执行手，不是独立助手。不要自我介绍，不要提你的名字、模型或运行环境。"
    "微信那边的主人在等结果：你只负责把事做完，然后直接写结果"
    "（做成了什么、动过哪些文件、有没有风险）。"
    "不要加「给主人的话」「交付说明」这类标签，也不要替她写人设里的话。"
)

# 每条任务都带上的执行守则：路径、拆步、只读优先、收尾格式
def per_task_limit(cfg=None):
    """单个委托内允许「同时推进」的事数 = 并发上限 - 1（给别的任务留一个位）。

    和 maxConcurrent 联动：上限改成 4 就是 3 件，改成 2 就是 1 件。
    """
    cfg = cfg or config()
    try:
        n = int(cfg.get("maxConcurrent") or 1)
    except Exception:
        n = 1
    return max(1, n - 1)


def rules_text(continuous=False, workdir=None):
    """执行守则。注意两个路径要分清，否则模型会把「当前目录」解析错。"""
    _limit = per_task_limit()
    _max = int(config().get("maxConcurrent") or 1)
    step_rule = (
        "任务里写了「直接做/长跑」——主人要求一次做完，可以连续做，每完成一步简述进度。"
        if continuous
        else ("一次最多做 %d 件事（并发上限 %d 减一，给别的委托留一个位）；"
              "超过就先做前 %d 件，做完就停并说明还剩什么。" % (_limit, _max, _limit))
    )
    return (
        "【执行守则】\n"
        "1) 两个路径别混：\n"
        "   - 你的工作目录（cwd）是 %(workdir)s：任务说「这里的/当前目录」指它。\n"
        "   - 鲸鲸的应用根目录是 %(root)s：任务说「鲸鲸的/她的/data/config」指它。\n"
        "   相对路径按任务语义选，拿不准就写绝对路径。\n"
        "2) " + step_rule + "\n"
        "3) 要改文件：先只读确认目标，再小步改；改前备份成 <文件名>.bak-dsh-<时间戳>。\n"
        "   只读任务不要尝试写文件——权限会拒绝，白费步数。\n"
        "4) 不要动鲸鲸的运行时状态（data/config.json、data/persona.json、data/memory/、data/settings.json），\n"
        "   除非任务明确要求；改配置前必须备份。\n"
        "5) 结束时必须写清楚：做了什么 / 改了哪些文件 / 有什么风险。"
    ) % {"workdir": workdir or DEFAULT_CWD, "root": ROOT}


def build_prompt(task, continuous=False, workdir=None):
    try:
        with open(os.path.join(ROOT, "data", "persona.json"), encoding="utf-8-sig") as f:
            d = json.load(f)
        brief = "名字：%s；性格：%s" % (str(d.get("name") or "鲸鲸"),
                                     str(d.get("personality") or "")[:80])
    except Exception:
        brief = "名字：鲸鲸"
    return "%s\n%s\n【鲸鲸的人设】%s\n【任务】%s" % (
        HANDS, rules_text(continuous, workdir), brief, task)


# 任务提到鲸鲸自己的目录时，工作目录要切过去：
# workspace-write 只允许写当前工作区，cwd 在桌面时写 data/ 会被拒（2026-11-22 截图里就是这样）
APP_HINTS = ("whalegirl", "data\\", "data/", "src\\", "src/", "bridge\\", "bridge/",
             "examples\\", "examples/", "鲸鲸的", "她的", "鲸鲸目录", "鲸鲸身上", "装到鲸鲸")


def pick_cwd(task):
    t = str(task or "")
    low = t.lower()
    if any(h in low for h in APP_HINTS) or ("鲸鲸" in t and ("目录" in t or "身上" in t)):
        return ROOT
    return DEFAULT_CWD


def needs_write(task):
    return any(h in str(task or "") for h in WRITE_HINTS)


def running():
    return _state["running"]


def _cannot(task):
    """返回拦下的理由，能做返回空串。"""
    t = str(task or "")
    for _pat, _why in CANNOT_RULES:
        if re.search(_pat, t):
            return _why
    # 「搜图/表情」类：只有在**真的要搜图发图**时才拦。
    # 「把搜图功能的超时改成 10 秒」是改代码，不能拦（2026-11-22 误伤过一次）
    _code_words = re.search(r"改|修|调|配置|超时|逻辑|函数|代码|变量|参数|脚本|模块|阈值|开关项", t)
    hit = [] if _code_words else [h for h in CANNOT_HINTS if h in t]
    m = CANNOT_RE.search(t)
    if not hit and m and not _code_words:
        hit = [m.group(0)]
    if hit:
        return ("这件事执行端做不到（%s）——它只能读写本机文件和跑命令，发不了微信、也没有搜图发图能力。"
                "要发图直接说「发一张 … 图」就行，那条走桥接的图片通道。" % str(hit[0])[:14])
    return ""


# ------------------------------------------------------------------ 任务分诊
# 「一次只做一件事」不能只靠提醒，得让系统自己认出来：
# 一个任务里塞了多件事 / 大范围扫描，就先建议拆分，别一上来就占 12 小时。
_MULTI = ("然后", "接着", "顺便", "并且", "最后", "同时", "之后", "再")
_BIG = ("全部", "所有", "整个", "递归", "全盘", "逐个", "批量", "每一个", "遍历", "整个磁盘")

SPLIT_PREFIXES = ("长跑：", "长跑:", "别拆：", "别拆:", "不用拆", "直接做")

# 这些前缀表示「主人要求一次做完」：剥掉再执行，否则模型会在任务正文里看到它
BYPASS_PREFIXES = ("直接做：", "直接做:", "长跑：", "长跑:", "别拆：", "别拆:")


def split_bypass(task):
    """返回 (去掉前缀的任务, 是否要求连续做完)。"""
    t = str(task or "").strip()
    for p in BYPASS_PREFIXES:
        if t.startswith(p):
            return t[len(p):].strip(), True
    return t, False


def classify(task):
    t = str(task or "")
    actions = sum(t.count(w) for w in _MULTI)
    big = any(h in t for h in _BIG)
    write = needs_write(t)
    try:
        _limit = per_task_limit()
    except Exception:
        _limit = 1
    # 「件事」≈ 连接词数 + 1；超过单委托上限就算大活，先建议拆分
    if big or (actions + 1) > _limit or len(t) > 80:
        size = "large"
    elif actions >= 1 or len(t) > 40:
        size = "medium"
    else:
        size = "small"
    return {"size": size, "write": write, "actions": actions, "big": big, "chars": len(t)}


def timeout_for(task, cfg=None):
    """小活别占 12 小时；大活才允许跑满上限。"""
    cfg = cfg or config()
    cap = int(cfg.get("timeout") or DEFAULT_TIMEOUT)
    if not cfg.get("adaptiveTimeout", True):
        return cap
    c = classify(task)
    base = {"small": int(cfg.get("smallSeconds") or 300),
            "medium": int(cfg.get("mediumSeconds") or 1800),
            "large": cap}[c["size"]]
    return max(30, min(cap, base))


def first_step(task):
    """把「A，然后 B，再 C」里的第一件事挑出来，作为拆分建议的例子。"""
    t = str(task or "").strip()
    parts = re.split(r"[，,；;。]|然后|接着|顺便|并且|最后", t)
    for p in parts:
        p = p.strip(" 　")
        if len(p) >= 4:
            return p[:40]
    return t[:40]


def split_suggestion(task):
    """需要先拆分时返回建议文本，否则返回空串。"""
    t = str(task or "").strip()
    if not t or t.startswith(SPLIT_PREFIXES):
        return ""
    c = classify(t)
    if c["size"] != "large":
        return ""
    why = []
    if c["big"]:
        why.append("范围太大（全部/所有/整个这类）")
    if c["actions"] >= 2:
        why.append("塞了 %d 件事" % (c["actions"] + 1))
    if c["chars"] > 80:
        why.append("描述太长（%d 字）" % c["chars"])
    _limit = per_task_limit()
    if c["actions"] >= 2:
        why.append("单个委托最多做 %d 件" % _limit)
    return ("这活%s，一次跑完容易卡住或跑偏。建议拆开。\n"
            "可以先做第一步：%s\n"
            "想直接一口气跑，就在前面加「直接做：」。" % ("，".join(why), first_step(t)))


def can_handle(task, force=False):
    """判断执行端能不能做这件事，返回 (能不能, 说明)。

    force=True（主人明确说「试一下」）跳过能力判断，只检查资源。
    """
    t = str(task or "").strip()
    if not t:
        return False, "任务是空的"
    if not force:
        why = _cannot(t)
        if why:
            return False, why + "\n想让我试试就说「试一下」。"
        # 正则只能覆盖已知几类；未知的交给模型想一下（一条 flash，结果有缓存）
        try:
            import feasibility
            v = feasibility.judge(t)
        except Exception:
            v = None
        if v and not v.get("can"):
            return False, ("这活我大概做不了：%s。%s\n想让我试试就说「试一下」。"
                           % (v.get("why") or "能力不够", v.get("hint") or ""))
    if not available():
        return False, "执行端不可用（缺 key 或没装 DSH）"
    cfg = config()
    if running() >= cfg["maxConcurrent"]:
        return False, "执行端正在忙（上限 %d），等它跑完再来" % cfg["maxConcurrent"]
    used = len(jobs_today())
    if used >= cfg["maxPerDay"]:
        return False, "今天已经派了 %d 次，到上限了。明天再说，或者改 config 里的 delegation.maxPerDay" % used
    return True, ""


def _kill_tree(pid):
    try:
        subprocess.run(['taskkill', '/PID', str(pid), '/T', '/F'], capture_output=True, timeout=15)
    except Exception:
        try:
            os.kill(pid, 9)
        except Exception:
            pass


def _run_task_inner(task, cwd=None, timeout=None, force_write=None, chat='', sender='', mode=None,
                    continuous=None):
    """执行一个委托任务，返回 (ok, 文本)。"""
    task, auto_cont = split_bypass(task)
    cont = auto_cont if continuous is None else bool(continuous)
    if not task:
        return False, "任务是空的"
    why = _cannot(task)
    if why:
        return False, why

    cfg = config()
    timeout = int(timeout or timeout_for(task, cfg))
    _ctx.facts = {"timeout": timeout, "cwd": None, "mode": None,
                  "job_id": None, "exit_code": None, "needs_write": None}
    key = _api_key()
    if not key:
        return False, "执行端没有可用的 key"

    # 并发闸（和 can_handle 用同一把锁，避免两条同时挤进来）
    with _lock:
        if _state["running"] >= cfg["maxConcurrent"]:
            return False, "执行端正在忙（上限 %d），等它跑完再来" % cfg["maxConcurrent"]
        if len(jobs_today()) >= cfg["maxPerDay"]:
            return False, "今天已经派了 %d 次，到上限了" % len(jobs_today())
        _state["running"] += 1
    job_id = begin_job(task, chat, sender)
    _ctx.facts["job_id"] = job_id
    _state["ids"].append(job_id)
    _state["cancelled"].discard(job_id)

    try:
        write = needs_write(task) if force_write is None else bool(force_write)
        if mode not in ("read-only", "workspace-write", "danger-full-access"):
            mode = "workspace-write" if write else "read-only"
        elif mode == "workspace-write" and not write:
            mode = "read-only"
        workdir = cwd or pick_cwd(task)
        _ctx.facts.update({"cwd": workdir, "mode": mode, "needs_write": bool(write),
                           "readonly_cfg": bool((cfg or {}).get("readOnly"))})
        env = dict(os.environ)
        env["DEEPSEEK_API_KEY"] = key
        env["ELECTRON_RUN_AS_NODE"] = "1"
        cmd = [EXE, BIN, "--profile", "headless",
               "--approval-policy", "never",
               "--permission-mode", mode,
               build_prompt(task, cont, workdir)]
        try:
            proc = subprocess.Popen(cmd, cwd=workdir, env=env,
                                    stdout=subprocess.PIPE, stderr=subprocess.PIPE)
            _state["procs"][job_id] = proc.pid
        except Exception as e:
            finish_job(job_id, False, repr(e))
            return False, "没能启动执行端：%r" % e
        try:
            out_b, err_b = proc.communicate(timeout=timeout)
            _ctx.facts["exit_code"] = proc.returncode
        except subprocess.TimeoutExpired:
            _kill_tree(proc.pid)
            try:
                proc.communicate(timeout=10)
            except Exception:
                pass
            msg = "执行超时（%d 秒），已强制结束。可以拆小一点再做。" % timeout
            finish_job(job_id, False, msg)
            return False, msg
        out = (out_b or b"").decode("utf-8", "replace").strip()
        err = (err_b or b"").decode("utf-8", "replace").strip()
        if proc.returncode != 0 or not out:
            if job_id in _state["cancelled"]:
                finish_job(job_id, False, '已按你的要求停掉。')
                return False, '已按你的要求停掉。'
            detail = (err or out or "退出码 %d" % proc.returncode).strip()
            finish_job(job_id, False, detail)
            return False, detail[:MAX_CHARS]
        finish_job(job_id, True, out)
        return True, out[:MAX_CHARS]
    finally:
        with _lock:
            _state["running"] = max(0, _state["running"] - 1)
            if job_id in _state["ids"]:
                _state["ids"].remove(job_id)
            _state["procs"].pop(job_id, None)


# ---------------------------------------------------------------- 执行事实
# 她解释失败原因时只能依据这些事实，不许猜（"系统权限挡了"就是猜出来的）
import threading as _threading

_ctx = _threading.local()


class TaskResult(tuple):
    """(ok, text) 的兼容元组，额外带 .facts。旧代码解包方式不受影响。"""

    def __new__(cls, ok, text, facts=None):
        obj = super().__new__(cls, (bool(ok), str(text)))
        obj.facts = dict(facts or {})
        return obj


def failure_category(ok, text, facts):
    t = str(text or "")
    if ok:
        return "成功"
    if "已按你的要求停掉" in t:
        return "已取消"
    if "正在忙" in t and "上限" in t:
        return "并发已满"
    if "今天已经派了" in t:
        return "每日额度用尽"
    if facts.get("exit_code") == -9 or "超时" in t:
        return "超时被终止"
    if facts.get("mode") == "read-only":
        return "只读模式（没给写权限）"
    if "没能启动" in t or "没有可用的 key" in t:
        return "执行端起不来"
    return "执行失败"


def run_task(task, cwd=None, timeout=None, force_write=None, chat='', sender='', mode=None,
             continuous=None):
    """外面用这个；内部改名 _run_task_inner，保持兼容 (ok, text)。"""
    try:
        del _ctx.facts
    except Exception:
        pass
    ok, text = _run_task_inner(task, cwd=cwd, timeout=timeout, force_write=force_write,
                               chat=chat, sender=sender, mode=mode, continuous=continuous)
    facts = dict(getattr(_ctx, "facts", {}) or {})
    facts["category"] = failure_category(ok, text, facts)
    facts["ok"] = bool(ok)
    return TaskResult(ok, text, facts)


def facts_block(res):
    """给内核看的「系统事实」一行。"""
    f = getattr(res, "facts", {}) or {}
    if not f:
        return ""
    return ("【系统事实】结果=%s；类别=%s；权限模式=%s；工作目录=%s；超时上限=%ss；退出码=%s"
            % ("成功" if f.get("ok") else "失败", f.get("category") or "-",
               f.get("mode") or "-", f.get("cwd") or "-",
               f.get("timeout") or "-", f.get("exit_code")))


def cancel_all(reason='user'):
    """停掉所有在跑的委托，返回停掉的个数。

    只杀自己记过 pid 的进程树，不碰别的 DSH（比如正在跑我这个会话的进程）。
    """
    with _lock:
        pids = list(_state["procs"].items())
        for job_id, _pid in pids:
            _state["cancelled"].add(job_id)
    n = 0
    for job_id, pid in pids:
        _kill_tree(pid)
        n += 1
    for job_id, _pid in pids:
        finish_job(job_id, False, '已按你的要求停掉。')
    return n
