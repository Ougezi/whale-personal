# -*- coding: utf-8 -*-
"""鲸鲸 · 抖音（一次性 sidecar 客户端）。

她不会自己开浏览器：桥接把 [[dy:...]] 交到这里，这里起一个独立的 Node 进程
（D:\\dsh\\profiles\\desktop\\whale-douyin\\service.mjs --once），真的去翻，
返回一段可转述的中文事实，再由内核让她用自己的话说。

为什么一次性：常驻守护进程会被启动器/工具进程树回收误杀，而插件本来每轮就
重开 Chrome；一次性进程反而不会留下“端口在、进程没了”的半死状态。
sidecar 有自己的 DSH_HOME、自己的 Chrome profile、自己的配额。
"""
import json
import os
import re
import subprocess

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SIDECAR = os.environ.get("WHALE_DOUYIN_DIR") or r"D:\dsh\profiles\desktop\whale-douyin"
NODE = os.path.join(ROOT, "runtime", "node.exe")
ENTRY = os.path.join(SIDECAR, "service.mjs")

MARKER_RE = re.compile(r"\[\[dy:\s*(.+?)(?:\]\]|$)", re.S)
CREATE_NO_WINDOW = 0x08000000


def available():
    return os.path.isfile(NODE) and os.path.isfile(ENTRY)


def _call(op, args=None, timeout=240):
    env = dict(os.environ)
    env["DSH_HOME"] = os.path.join(SIDECAR, "state")
    try:
        proc = subprocess.run(
            [NODE, ENTRY, "--once", op, json.dumps(args or {}, ensure_ascii=False)],
            cwd=SIDECAR, env=env, capture_output=True, timeout=timeout,
            creationflags=CREATE_NO_WINDOW)
    except subprocess.TimeoutExpired:
        return {"ok": False, "code": "timeout", "text": "抖音这边超时了（%d 秒），这轮没刷完" % timeout}
    except Exception as e:
        return {"ok": False, "code": "spawn-failed", "text": "抖音进程起不来：%s" % str(e)[:120]}
    stdout = (proc.stdout or b"").decode("utf-8", "replace")
    for line in stdout.splitlines():
        if line.startswith("@@RESULT@@"):
            try:
                return json.loads(line[len("@@RESULT@@"):])
            except Exception:
                break
    detail = ((proc.stderr or b"").decode("utf-8", "replace") or stdout).strip()[-300:]
    return {"ok": False, "code": "no-output", "text": "抖音没返回结果：%s" % (detail or "退出码 %s" % proc.returncode)}


def extract(text):
    """从她的回复里抽出 [[dy:...]]，返回 (清理后的文本, 任务)。闭合括号可选。"""
    s = str(text or "")
    tasks = [m.group(1).strip() for m in MARKER_RE.finditer(s) if m.group(1).strip()]
    clean = MARKER_RE.sub("", s)
    clean = re.sub(r"[，,、]\s*[。！？!?]", "。", clean)
    clean = re.sub(r"[ \t]+\n", "\n", clean)
    clean = re.sub(r"\n{3,}", "\n\n", clean).strip()
    if tasks and len(clean) < 4:
        clean = "好，我去翻翻。"
    return clean, (tasks[0] if tasks else "")


_NUM = re.compile(r"(\d{1,2})\s*(?:条|个|张)")


_URL = re.compile(r"https?://[^\s，。]+")


def route(task):
    """自然语言 → (操作, 参数)。宁可多看一轮，也不要猜太细。"""
    t = str(task or "")
    url = ""
    murl = _URL.search(t)
    if murl:
        url = murl.group(0).rstrip(".,;!?)）】]")
    if re.search(r"下载|存下来|保存(视频|图片|图文)|原图", t):
        return "download", {"modalId": url or t, "parts": ["video", "images", "audio", "cover"]}
    if re.search(r"主页|作者|博主|ta的|他的作品|她的作品|合集|收藏", t):
        if url or re.search(r"MS4wLjAB", t):
            arg = url or re.search(r"(MS4wLjAB[\w-]+)", t).group(1)
            return "user", {"user": arg, "limit": 20}
        q = re.sub(r"^(看看|读一下|读|查|找|搜一下|搜)(一下)?", "", t)
        q = re.sub(r"(的主页|主页|的作品|作品|合集|收藏).*$", "", q).strip()
        return "user", {"query": q or t, "limit": 20}
    if re.search(r"搜用户|找用户|用户搜索", t):
        q = re.sub(r".*(搜用户|找用户|用户搜索)[:：]?", "", t).strip()
        return "search_users", {"keyword": q or t, "limit": 20}
    if re.search(r"评论", t):
        return "comments", {"modalId": url or t, "limit": 20, "replies": True}
    if re.search(r"导出|csv|json", t):
        return "export", {"format": "csv" if "csv" in t.lower() else "json"}
    if re.search(r"索引|检索|sqlite", t):
        return "index", {"query": ""}
    if re.search(r"批量|跑一遍|全跑", t):
        return "batch", {}
    if re.search(r"直播", t):
        return "live", {"url": url} if url else {}
    if re.search(r"账号|通道|profile", t):
        return "accounts", {"action": "list"}
    if re.search(r"点赞", t):
        return "like", {"modalId": url or t, "confirm": True}
    if re.search(r"收藏这条|收藏一下", t):
        return "collect", {"modalId": url or t, "confirm": True}
    if re.search(r"热榜|热搜|热度|热门", t):
        return "hot", {"limit": 10}
    if re.search(r"日报|汇总|总结|今天.{0,4}(看了|刷了)", t):
        return "report", {}
    if re.search(r"最近|刚才|上次|看了(些)?什么|看过什么", t):
        return "recent", {"n": 10}
    if re.search(r"登录|扫码", t):
        return "login", {"navigate": True}
    m = _NUM.search(t)
    cards = int(m.group(1)) if m else 6
    return "watch", {"cards": max(1, min(cards, 10))}


_LABEL = {
    "watch": "刷一轮推荐流",
    "hot": "读抖音热榜",
    "report": "看今天的观看日报",
    "recent": "翻最近看过的",
    "login": "看抖音登录状态",
    "status": "看抖音状态",
    "download": "下载这条作品",
    "user": "读作者主页",
    "collection": "读合集/收藏",
    "live": "看直播状态",
    "search_users": "搜抖音用户",
    "comments": "读评论",
    "export": "导出知识库",
    "index": "知识库建索引/检索",
    "batch": "批量跑作者/关键词",
    "accounts": "看浏览器账号通道",
    "like": "点赞",
    "collect": "收藏",
}


def run(task, timeout=None):
    """执行一条抖音指令，返回 (ok, 文本)。文本是给内核转述用的事实。"""
    task = str(task or "").strip()
    if not task:
        return False, "没说要刷什么"
    if not available():
        return False, "抖音模块不在（sidecar 目录或 node 缺失），这轮没刷成"
    op, args = route(task)
    slow = op in ("watch", "hot", "download", "user", "batch", "comments", "collection", "live", "search_users")
    out = _call(op, args, timeout=timeout or (240 if slow else 60))
    text = str(out.get("text") or "").strip()
    ok = bool(out.get("ok"))
    if not text:
        text = "没拿到内容（%s）" % (out.get("code") or "unknown")
    return ok, text


def status():
    """自检用：不打开浏览器，只问健康与配额。"""
    try:
        return _call("status", {}, timeout=40)
    except Exception as e:
        return {"ok": False, "why": str(e)[:120]}
