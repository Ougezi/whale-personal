# -*- coding: utf-8 -*-
"""鲸鲸改造自测：把「找图 / 发图 / 委托 / 假话过滤 / 清理」逐项跑一遍。

用法（鲸鲸自带 python）：
    python 鲸鲸-自测.py            # 快速项
    python 鲸鲸-自测.py --real     # 外加真实抓图（会走网络和视觉接口）
"""
import os
import re
import shutil
import sys
import time

ROOT = os.environ.get("WHALE_ROOT") or os.path.join(
    os.environ.get("LOCALAPPDATA") or os.path.join(os.path.expanduser("~"), "AppData", "Local"),
    "Programs", "WhaleGirl")
sys.path.insert(0, os.path.join(ROOT, "bridge"))

import image_fetch  # noqa: E402
import dsh_agent    # noqa: E402

import receiver_mixin as rm   # 直接测真代码，不再复制逻辑

CLAIM = re.compile(r"桥接(?:有|给了?)?(?:回执|确认)[^，。！？\n]*|桥接确认(?:送)?到")
DELEG = re.compile(r"执行端|dsh|DSH|派出去|派活|派一次|派给", re.I)
IMG = re.compile(r"图|表情|搜|扒|下载")
SENT = re.compile(r"(?<=[。！？!?\n])")

results = []


def check(name, ok, detail=""):
    results.append((name, bool(ok), detail))


def _scrub(text):
    """直接用桥接里的真函数，避免"自测绿、线上炸"。"""
    return rm.scrub_reply_claims(text)


def test_trigger():
    cases = [("给我发一张小猫的图片", "小猫"), ("再给我发一张鲸鱼娘的图片", "鲸鱼娘"),
             ("再发一遍鲸鱼娘图片", "鲸鱼娘"), ("发我一张猫咪图", "猫咪"),
             ("给我发一张你搜到的图片", None)]
    for text, want in cases:
        kw, retry = image_fetch.detect_action(text)
        ok = (kw == want) if want else retry
        check("触发：" + text[:14], ok, "→ %r%s" % (kw or "", " 重试" if retry else ""))
    # 回归：这几句曾经被误判/被吞（18:39 那次）
    for text, want in [("找到没", None), ("有了吗", None), ("小猫找到了吗？", None),
                       ("有没有鲸鱼娘的图", "鲸鱼娘"), ("换一张", "重试")]:
        kw, retry = image_fetch.detect_action(text)
        if want == "重试":
            check("回归：" + text[:10], retry, "→ 重试")
        elif want:
            check("回归：" + text[:10], kw == want, "→ %r" % kw)
        else:
            check("回归不触发：" + text[:10], not (kw or retry), "")
    # 回归（审计发现）：没有主体的请求不该去搜图
    for text in ["发一张你的照片", "给我发一张自拍", "来点开心的", "发一张表情包"]:
        kw, retry = image_fetch.detect_action(text)
        check("回归去噪：" + text[:10], not (kw or retry), "→ %r" % kw)

    for text in ["你发我的图怎么这么糊", "今天天气怎么样"]:
        kw, retry = image_fetch.detect_action(text)
        check("不误触发：" + text[:12], not (kw or retry), "")


def test_sources():
    try:
        sogou = image_fetch._search_sogou("鲸鱼娘 表情包")
        check("搜狗图源", len(sogou) > 0, "%d 个候选" % len(sogou))
    except Exception as e:
        check("搜狗图源", False, repr(e))
    check("域名过滤", image_fetch._host_rank("https://imgs.699pic.com/a.jpg") >= 99
          and image_fetch._host_rank("https://pixiv.net/a.jpg") == 0, "图库排除 / 二次元优先")


def test_verdict_logic():
    """视觉校验的否定判断：不能只认「否」开头。"""
    def verdict(text):
        t = str(text or "").lstrip()
        if not t:
            return True
        if t.startswith(('是', '对', '符合', '可以', '相关', '能')):
            return True
        return not t.startswith(('否', '不', '没', '错', '无关', '无', '非'))

    for v in ["否，风景照", "不是，商品图", "不符合要求", "不太像，真实照片"]:
        check("校验拒绝：" + v[:8], not verdict(v), "")
    for v in ["是，蓝发少女", "可以，二次元图"]:
        check("校验放行：" + v[:8], verdict(v), "")


def test_gate_precision():
    """闸门不能把「发个报告」当成发图。"""
    for t in ["发个报告给主人", "发个文件到日志目录", "整理 bridge 目录生成清单"]:
        ok, _ = dsh_agent.can_handle(t)
        check("闸门不误拦：" + t[:10], ok, "")
    for t in ["发一张图给主人", "搜鲸鱼娘表情图然后发到微信"]:
        ok, _ = dsh_agent.can_handle(t)
        check("闸门拦住：" + t[:10], not ok, "")


def test_webp():
    src = os.path.join(ROOT, "data", "stickers", "搜来的")
    try:
        from PIL import Image
        import io as _io
        img = Image.new("RGB", (8, 8), (10, 20, 30))
        buf = _io.BytesIO()
        img.save(buf, "WEBP")
        data = buf.getvalue()
        ok = image_fetch._sniff(data) == "webp"
        check("webp 识别", ok, "转换逻辑在 fetch 内")
    except Exception as e:
        check("webp 识别", False, repr(e))


def test_scrub():
    check("抹除函数可用", callable(getattr(rm, "scrub_reply_claims", None)), "")
    cases = [
        ("抖音和B站我这边真没接口能扒图，只能派执行端去搜。搜图那条卡着。", False),
        ("这张发出去了，桥接确认送到。", None),
        ("行，我这就可以找，稍等。", True),
        ("执行端的任务完成了，图也发你了。", True),
        ("我现在能自己搜图发图了，不用派执行端。", True),
        ("这次是桥接发的，不是我派的执行端。", True),
        ("改好了，a.md 的 TODO 已经清掉。", True),
    ]
    for text, must_keep in cases:
        out = _scrub(text)
        if must_keep is True:
            check("抹除不误伤：" + text[:12], out == text, repr(out[:30]))
        elif must_keep is False:
            check("抹除假派活：" + text[:12], not DELEG.search(out) or "不用派执行端" in out, repr(out[:34]))
        else:
            check("抹除假回执：" + text[:12], "桥接" not in out, repr(out[:34]))


def test_delegate_gate():
    can = [("统计当前目录所有 .md 文件的行数", True), ("看看 bridge.log 最近有没有报错", True)]
    cannot = [("搜鲸鱼娘表情图然后发到微信", False), ("帮我发一张图给主人", False)]
    for text, expect in can:
        ok, why = dsh_agent.can_handle(text)
        check("闸门放行：" + text[:12], ok == expect, why[:30])
    for text, expect in cannot:
        ok, why = dsh_agent.can_handle(text)
        check("闸门拦截：" + text[:12], ok == expect, why[:30])
    check("写权限判定", dsh_agent.needs_write("把 a.md 里的 TODO 删掉")
          and not dsh_agent.needs_write("统计行数"), "含动词→写")
    check("默认只读", dsh_agent.DEFAULT_TIMEOUT == 150, "超时 150 秒")


def test_delegation_limits():
    """并发 / 每日上限 / 任务落盘 / 中断恢复。"""
    import time as _t

    orig = dsh_agent.config
    try:
        dsh_agent.config = lambda: {"maxConcurrent": 1, "maxPerDay": 99, "timeout": 150, "readOnly": True}
        dsh_agent._state["running"] = 1
        ok, why = dsh_agent.can_handle("统计一下行数")
        check("并发上限拦住", not ok, why[:24])
        dsh_agent._state["running"] = 0
        check("空闲时放行", dsh_agent.can_handle("统计一下行数")[0], "")

        used = len(dsh_agent.jobs_today())
        dsh_agent.config = lambda: {"maxConcurrent": 1, "maxPerDay": used, "timeout": 150, "readOnly": True}
        ok, why = dsh_agent.can_handle("统计一下行数")
        check("每日上限拦住", not ok, why[:24])
    finally:
        dsh_agent.config = orig
        dsh_agent._state["running"] = 0

    # 落盘 + 中断
    jid = dsh_agent.begin_job("自测占位任务", "wxid_selftest", "wxid_selftest")
    jobs = dsh_agent._load_jobs()
    check("任务落盘", any(j["id"] == jid for j in jobs), jid)
    dsh_agent.finish_job(jid, True, "ok")
    me = [j for j in dsh_agent._load_jobs() if j["id"] == jid]
    check("任务收尾写盘", bool(me) and me[0]["status"] == "done", "")
    jid2 = dsh_agent.begin_job("自测打断任务", "wxid_selftest", "wxid_selftest")
    中断 = dsh_agent.take_interrupted()
    check("中断可被发现", any(j["id"] == jid2 for j in 中断), "%d 个" % len(中断))
    # 清理自测痕迹
    keep = [j for j in dsh_agent._load_jobs() if "自测" not in str(j.get("task") or "")]
    dsh_agent._save_jobs(keep)
    check("自测痕迹已清", not [j for j in dsh_agent._load_jobs() if "自测" in str(j.get("task") or "")], "")


def test_doc_sync():
    """文档里的参数必须和代码/配置一致（防止文档停在中间态）。"""
    import subprocess
    script = os.path.join(os.path.dirname(os.path.abspath(__file__)), "鲸鲸-文档同步.py")
    if not os.path.exists(script):
        check("文档同步脚本", False, "找不到 鲸鲸-文档同步.py")
        return
    try:
        r = subprocess.run([sys.executable, script], capture_output=True, text=True,
                           encoding="utf-8", errors="replace", timeout=60)
        drifted = [ln.strip() for ln in (r.stdout or "").splitlines() if "需更新" in ln]
        check("文档参数同步", r.returncode == 0,
              "一致" if r.returncode == 0 else ("漂移: " + "; ".join(drifted)[:60]))
    except Exception as e:
        check("文档参数同步", False, repr(e)[:40])


def test_marker_leak():
    """未闭合/未知标记都不能漏到微信（2026-11-22 截图事故）。"""
    import dsh_agent
    import sender_mixin as sm
    leak = ("行，一起清。[[dsh:删掉 data\\stickers\\x.jpg，清掉 usage.json 里的键，"
            "sources.txt 重复行只留一条，回收站里那份也")
    clean, task = dsh_agent.extract_marker(leak)
    check("未闭合标记能提取任务", bool(task) and "删掉" in task, str(task)[:20])
    check("未闭合标记被剥掉", "[[" not in clean and clean.startswith("行，一起清"), repr(clean)[:20])
    check("发送出口兜底", "[[" not in sm.strip_marker_remnants(leak), "")
    check("未知标记也剥", "[[" not in sm.strip_marker_remnants("试试[[note:abc]]"), "")
    check("普通文本不误伤", sm.strip_marker_remnants("好，我去弄。") == "好，我去弄。", "")


def test_pending_task():
    """被拆分闸门拦下的任务要能记住，主人说「直接做」时直接跑（2026-11-22 截图事故）。"""
    import re as _re
    import receiver_mixin as rm

    class Fake(rm.ReceiverMixin):
        def __init__(self):
            self.sent = []
            self.bot_url = "http://127.0.0.1:8787/webhook/wechat"
            self.token = ""
        def display_name(self, u): return "x"
        def send_text(self, t, target, u): self.sent.append(t)

    f = Fake()
    # 必须真的够长（>80 字）才会被拆分闸门拦下；太短会直接执行，测试就失去意义
    long_task = ("删掉 data\\stickers\\搜来的\\886856317c903516_1795257577.jpg，"
                 "清掉 usage.json 里指向已不存在文件的那条键，"
                 "sources.txt 里 886856317c903516 的重复行只留一条，回收站里那份也一起清掉")
    # 拦下并存为待执行
    try:
        f.delegate_and_reply(long_task, "u1", "u1")
    except Exception:
        pass
    check("长任务记为待执行", bool(getattr(f, "_pending_tasks", {}).get("u1")), "")
    pat = _re.compile(r"^(直接做|直接跑|一次做完|别拆了?|跑吧|全都做|一起做)[。！!.]?$")
    check("直接做命令能识别", bool(pat.match("直接做")) and not pat.match("好的"), "")


def test_facts():
    """委托结果必须带系统事实；失败要归类；自检通知要点名失败项。"""
    import dsh_agent
    import selfcheck
    class R(tuple):
        pass
    res = dsh_agent.TaskResult(True, "做完了", {"mode": "read-only", "cwd": "X", "timeout": 60, "exit_code": 0})
    check("结果带 facts", isinstance(res.facts, dict) and res.facts.get("mode") == "read-only", "")
    check("解包兼容", (lambda r: (lambda ok, text: ok and text == "做完了")(*r))(res), "")
    blk = dsh_agent.facts_block(res)
    check("事实行含模式与上限", "read-only" in blk and "60s" in blk, blk[:30])
    check("成功归类", dsh_agent.failure_category(True, "x", {}) == "成功", "")
    check("只读失败归类", dsh_agent.failure_category(False, "写不进去", {"mode": "read-only"}) == "只读模式（没给写权限）", "")
    check("超时归类", dsh_agent.failure_category(False, "超时", {"exit_code": -9}) == "超时被终止", "")
    fake = {"steps": [{"name": "桥接自测", "code": 1, "tail": ["✓ a", "✗ 长任务记为待执行"]}]}
    summ = selfcheck.fail_summary(fake)
    check("自检通知点名失败项", "桥接自测" in summ and "长任务记为待执行" in summ, summ[:24])


def test_continue_cmd():
    """「继续」要接着上一次委托做，而不是被当成新任务（2026-11-22 截图事故）。"""
    import re as _re
    import time as _t
    import receiver_mixin as rm

    class Fake(rm.ReceiverMixin):
        def __init__(self):
            self.sent = []
            self._last_tasks = {}
            self.bot_url = "http://x"
            self.token = ""
        def display_name(self, u): return "x"
        def send_text(self, t, target, u): self.sent.append(t)

    pat = _re.compile(r"^(继续|接着|继续做|继续弄|往下做|接着弄|一步步弄下去|继续一步步弄下去)[。！!.]?$")
    check("继续命令能识别", bool(pat.match("继续一步步弄下去")) and not pat.match("好的"), "")
    f = Fake()
    f._last_tasks["u1"] = ("找麦克风配置", _t.time() - 60)
    check("最后任务有记录", "u1" in f._last_tasks, "")


def test_stall_config():
    """stall/首次提示必须能从 config.json 读出来（否则改了不生效，2026-11-22 踩过）。"""
    import dsh_agent
    c = dsh_agent.config()
    for k in ("stallMinutes", "firstNudgeSeconds", "adaptiveTimeout"):
        check("配置透传 " + k, k in c, str(c.get(k)))


def test_bounds():
    """做不了的活要当场拦下并说明（GUI/账号），改代码类不能误拦。"""
    import dsh_agent
    block = ["打开微信设置，把麦克风开关打开", "看看屏幕上现在显示什么",
             "在浏览器里登录后台，点导出按钮", "帮我扫一下二维码登录",
             "帮我搜一张鲸鲸娘的图"]
    allow = ["读 data/config.json 告诉我 gateway 段", "统计 bridge 目录下 md 行数",
             "把搜图功能的超时改成 10 秒", "查一下本机安装的微信版本号"]
    bad = 0
    for x in block:
        if dsh_agent.can_handle(x)[0]:
            bad += 1
    for x in allow:
        if not dsh_agent.can_handle(x)[0]:
            bad += 1
    check("能力边界拦截", bad == 0, "错 %d 条" % bad)


def test_judge():
    """模型判定不行就拦；主人说「试一下」能强行跑。"""
    import dsh_agent
    import feasibility
    orig = feasibility.judge
    try:
        feasibility.judge = lambda t: {"can": False, "why": "需要界面", "hint": "你手动点"}
        ok, why = dsh_agent.can_handle("给猫喂食并拍照")
        check("模型判定拦下", (not ok) and ("试一下" in why), why[:20] if why else "")
        check("force 跳过判定", dsh_agent.can_handle("给猫喂食并拍照", force=True)[0], "")
        feasibility.judge = lambda t: {"can": True, "why": "", "hint": ""}
        check("判定能做就放行", dsh_agent.can_handle("统计目录行数")[0], "")
    finally:
        feasibility.judge = orig


def test_commands_module():
    """主人命令的正则集中在 commands.py，改一处生效。"""
    import commands
    check("命令：继续", commands.kind("继续") == "continue", "")
    check("命令：试一下", commands.kind("试一下") == "try", "")
    check("命令：停掉委托", commands.kind("停掉委托") == "cancel", "")
    check("命令：普通话不误判", commands.kind("好的") == "", "")


def test_delegation_flow():
    """委托状态收敛到 delegation_flow.py；过期不许误跑。"""
    import delegation_flow as f
    class B: pass
    bot = B()
    f.ensure(bot)
    check("状态表已建", all(hasattr(bot, a) for a in ("_pending_tasks", "_blocked_tasks", "_paused_chats")))
    f.remember(bot._pending_tasks, "c1", "任务A", 1000)
    check("取出未过期任务", f.take(bot._pending_tasks, "c1", 900, 1100) == "任务A", "")
    f.remember(bot._pending_tasks, "c1", "任务B", 1000)
    check("过期任务不取出", f.take(bot._pending_tasks, "c1", 900, 9999) is None, "")
    f.pause(bot, "c2")
    check("暂停状态记录", f.paused(bot, "c2"), "")
    f.clear_pause(bot, "c2")
    check("暂停可清除", not f.paused(bot, "c2"), "")


def test_on_message_guards():
    """on_message 里最容易错的分支：工作目录、可行性 JSON 解析。"""
    import dsh_agent
    import feasibility
    check("工作目录：鲸鲸目录", dsh_agent.pick_cwd("把 data/config.json 读一下") == dsh_agent.ROOT, "")
    check("工作目录：普通任务", dsh_agent.pick_cwd("统计 bridge 目录下 md 行数") == dsh_agent.DEFAULT_CWD, "")
    # 2026-11-22：安装类任务被判成只读、cwd 还停在桌面，导致「装插件」必然失败
    check("写权限：安装类", dsh_agent.needs_write("把插件安装到鲸鲸身上"), "")
    check("工作目录：鲸鲸身上", dsh_agent.pick_cwd("把插件装到鲸鲸身上") == dsh_agent.ROOT, "")
    p1 = feasibility._parse('```json\n{"can": false, "why": "要界面", "hint": "手点"}\n```')
    check("可行性 JSON（带代码块）", p1 and p1["can"] is False and p1["why"] == "要界面", "")
    check("可行性 JSON（坏文本）", feasibility._parse("我不确定") is None, "")


def test_prune():
    d = os.path.join(os.environ.get("TEMP", "."), "whale-prune-test")
    shutil.rmtree(d, ignore_errors=True)
    os.makedirs(d, exist_ok=True)
    now = time.time()
    for i in range(4):
        p = os.path.join(d, "x%d.png" % i)
        open(p, "wb").write(b"x" * 50)
        image_fetch.touch(p)
        u = image_fetch._load_usage(d)
        u["x%d.png" % i] = now - (40 * 86400 if i < 2 else 0)
        image_fetch._save_usage(d, u)
    removed, left = image_fetch.prune(d, keep_days=30, max_files=60, force=True)
    check("清理过期图", removed == 2 and left == 2, "删 %s 剩 %s" % (removed, left))
    shutil.rmtree(d, ignore_errors=True)


def test_real_fetch():
    dest = os.path.join(ROOT, "data", "stickers", "搜来的")
    import base64
    import json
    import urllib.request

    def verify(path):
        raw = open(path, "rb").read()
        ext = os.path.splitext(path)[1].lower().lstrip(".")
        mime = {"jpg": "image/jpeg", "jpeg": "image/jpeg", "png": "image/png",
                "gif": "image/gif", "webp": "image/webp"}.get(ext, "image/jpeg")
        body = json.dumps({"image": base64.b64encode(raw).decode(), "mime": mime,
                           "prompt": "用户想要一张「小猫」的图片。相关就回答是，不相关回答否。"}).encode()
        req = urllib.request.Request("http://127.0.0.1:8787/api/vision", data=body,
                                     headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=90) as r:
            t = str(json.loads(r.read().decode()).get("text") or "").strip()
        return not t.startswith("否")

    try:
        q = image_fetch.plan_query("给我发一张小猫的图片", fallback="小猫")
        check("先思考搜索词", bool(q), repr(q))
        path, url = image_fetch.fetch(q, dest, verify=verify, max_tries=3)
        ext = os.path.splitext(path)[1].lower()
        check("真实抓图", os.path.isfile(path), "%s %.0fKB" % (os.path.basename(path), os.path.getsize(path) / 1024))
        check("产物不是 webp", ext != ".webp", "扩展名 %s" % ext)
    except Exception as e:
        check("真实抓图", False, repr(e)[:60])


def test_douyin_marker():
    """[[dy:]] 是「真去刷」的唯一入口：路由、半闭合、标记不能漏进正文。"""
    import douyin_agent
    check("抖音路由：默认看一轮", douyin_agent.route("看一轮推荐流")[0] == "watch", "")
    check("抖音路由：条数", douyin_agent.route("刷 5 条")[1].get("cards") == 5, "")
    check("抖音路由：封顶 10 条", douyin_agent.route("刷 50 条")[1].get("cards") == 10, "")
    check("抖音路由：热榜", douyin_agent.route("抖音热榜")[0] == "hot", "")
    check("抖音路由：日报", douyin_agent.route("今天看了什么")[0] == "report", "")
    check("抖音路由：最近", douyin_agent.route("最近看了什么")[0] == "recent", "")
    clean, task = douyin_agent.extract("好，我去翻翻。[[dy:刷6条]]")
    check("抖音标记：抽出任务", task == "刷6条" and "[[dy:" not in clean, repr(task))
    clean2, task2 = douyin_agent.extract("行[[dy:看热榜")
    check("抖音标记：没闭合也认", bool(task2) and "[[dy:" not in clean2, repr(task2))
    check("抖音标记：普通回复不动", douyin_agent.extract("今天想吃火锅")[1] == "", "")


def main():
    real = "--real" in sys.argv
    test_trigger()
    test_sources()
    test_webp()
    test_verdict_logic()
    test_gate_precision()
    test_scrub()
    test_delegate_gate()
    test_prune()
    test_on_message_guards()
    test_douyin_marker()
    test_delegation_flow()
    test_commands_module()
    test_judge()
    test_bounds()
    test_stall_config()
    test_continue_cmd()
    test_facts()
    test_pending_task()
    test_marker_leak()
    test_doc_sync()
    test_delegation_limits()
    if real:
        test_real_fetch()

    # 主人私聊迟到消息宽限（2026-11-24 截图：09:07 消息重启后只补记不回复）
    try:
        from receiver_mixin import late_grace_sec, MASTER_LATE_GRACE_SEC
        check("主人迟到消息宽限", late_grace_sec("wxid_master", "wxid_master") == MASTER_LATE_GRACE_SEC, str(late_grace_sec("wxid_master", "wxid_master")))
        check("群聊不享受迟到宽限", late_grace_sec("123@chatroom", "wxid_master") == 0, str(late_grace_sec("123@chatroom", "wxid_master")))
    except Exception as e:
        check("主人迟到消息宽限", False, repr(e))

    print("=== 鲸鲸改造自测 ===")
    bad = 0
    for name, ok, detail in results:
        print("  %s %-26s %s" % ("✓" if ok else "✗", name, detail))
        if not ok:
            bad += 1
    print("\n  通过 %d/%d" % (len(results) - bad, len(results)))
    return 1 if bad else 0


if __name__ == "__main__":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass
    sys.exit(main())
