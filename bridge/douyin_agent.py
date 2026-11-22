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


def route(task):
    """自然语言 → (操作, 参数)。宁可多看一轮，也不要猜太细。"""
    t = str(task or "")
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
}


def run(task, timeout=None):
    """执行一条抖音指令，返回 (ok, 文本)。文本是给内核转述用的事实。"""
    task = str(task or "").strip()
    if not task:
        return False, "没说要刷什么"
    if not available():
        return False, "抖音模块不在（sidecar 目录或 node 缺失），这轮没刷成"
    op, args = route(task)
    out = _call(op, args, timeout=timeout or (240 if op in ("watch", "hot") else 60))
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
