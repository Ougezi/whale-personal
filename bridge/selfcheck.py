# -*- coding: utf-8 -*-
"""定时自检（默认每 30 分钟；失败后 90 秒复核，仍失败才通知）。

跑三件轻量检查：文档是否漂移、内核记忆逻辑、桥接功能自测。
结果写 data/selfcheck-status.json + 追加 data/selfcheck.jsonl；
失败时给主人发一条消息（每小时最多一次，避免刷屏）。

设计取舍：
- 只跑「快速」模式（不联网抓图），单次约 7 秒，每 15 分钟一次不会打扰。
- 全部用 subprocess 跑，超时硬杀，避免自检本身把桥接卡死。
- 线程是 daemon：桥接退出它就没了，不需要额外清理。
"""
import json
import os
import subprocess
import threading
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCRIPTS = os.path.join(ROOT, "scripts", "personal")
if not os.path.isfile(os.path.join(SCRIPTS, "鲸鲸-内核自测.js")):
    SCRIPTS = r"D:\dsh\profiles\desktop"
PY = os.path.join(ROOT, "runtime", "python", "python.exe")
NODE = os.path.join(ROOT, "runtime", "node.exe")

STATUS_FILE = os.path.join(ROOT, "data", "selfcheck-status.json")
LOG_FILE = os.path.join(ROOT, "data", "selfcheck.jsonl")
FIRST_DELAY = 60          # 启动后 60 秒跑第一次
CONFIRM_DELAY = 90        # 失败后复核等待（过滤改代码的瞬时状态）
DEFAULT_INTERVAL_MIN = 15
_notify_last = [0.0]
_started = [False]


def _settings():
    """从 config.json 读开关与间隔；读不到就用默认。"""
    out = {"enabled": True, "intervalMinutes": DEFAULT_INTERVAL_MIN, "notify": True}
    try:
        with open(os.path.join(ROOT, "data", "config.json"), encoding="utf-8-sig") as f:
            cfg = json.load(f)
        sc = cfg.get("selfcheck") or {}
        if sc.get("enabled") is False:
            out["enabled"] = False
        try:
            v = int(sc.get("intervalMinutes") or DEFAULT_INTERVAL_MIN)
            out["intervalMinutes"] = max(1, min(1440, v))
        except Exception:
            pass
        if sc.get("notify") is False:
            out["notify"] = False
    except Exception:
        pass
    return out


def _run(name, cmd, timeout):
    t0 = time.time()
    try:
        env = dict(os.environ)
        env["WHALE_ROOT"] = ROOT
        env["PYTHONIOENCODING"] = "utf-8"
        r = subprocess.run(cmd, cwd=ROOT, env=env, capture_output=True, timeout=timeout,
                           text=True, encoding="utf-8", errors="replace")
        code = r.returncode
        lines = ((r.stdout or "") + (r.stderr or "")).strip().splitlines()
        bad = [x for x in lines if x.strip().startswith("✗")]
        tail = (bad[-3:] if bad else lines[-3:])
    except subprocess.TimeoutExpired:
        code = -9
        tail = ["超时（%ds）" % timeout]
    except Exception as e:
        code = -1
        tail = [repr(e)]
    return {"name": name, "code": code, "seconds": round(time.time() - t0, 1), "tail": tail}


def run_checks():
    """跑一轮。分级处置：
       · 文档漂移 → 自动 --write 再复检（自愈，不打扰主人）
       · 其他失败 → 记下来，通知主人，并写入 freeze（暂停自我改代码）
       · 全绿 → 清掉 freeze
    """
    doc_script = os.path.join(SCRIPTS, "鲸鲸-文档同步.py")
    frozen_path = os.path.join(ROOT, "data", "self", "freeze.json")
    # 文档检查必须第一个跑并先自愈：桥接自测和冲突审查都会检查文档，
    # 文档漂着时它们会连带判红（踩过）
    rest = [
        ("内核自测", [NODE, os.path.join(SCRIPTS, "鲸鲸-内核自测.js")], 180),
        ("桥接自测", [PY, "-B", os.path.join(SCRIPTS, "鲸鲸-自测.py")], 300),
        ("冲突审查", [PY, "-B", os.path.join(SCRIPTS, "鲸鲸-冲突审查.py")], 180),
    ]
    _daily_snapshot()
    _prune_backups()
    rotated = _rotate_logs()
    free_gb = _disk_free_gb()
    if 0 <= free_gb < DISK_WARN_GB:
        rest.append(("磁盘水位", [PY, "-c", "import sys; sys.exit(1)"], 10))

    healed = []

    # ① 先查文档；漂了就自愈并复检（安全操作，不打扰主人）
    doc_step = _run("文档同步", [PY, "-B", doc_script], 120)
    if doc_step["code"] != 0:
        fix = _run("文档自愈", [PY, "-B", doc_script, "--write"], 120)
        if fix["code"] == 0:
            again = _run("文档同步复核", [PY, "-B", doc_script], 120)
            if again["code"] == 0:
                again["autoFixed"] = True
                doc_step = again
                healed.append("文档同步")
                try:
                    import engine as G
                    G.log('自检自愈：文档参数漂移已自动写回')
                except Exception:
                    pass

    # ② 自愈之后再跑其余检查，避免被文档漂移连带判红
    steps = [doc_step] + [_run(n, c, t) for n, c, t in rest]

    fails = [s["name"] for s in steps if s["code"] != 0]
    result = {
        "at": time.strftime("%Y-%m-%d %H:%M:%S"),
        "ok": not fails,
        "fails": fails,
        "healed": healed,
        "steps": steps,
        "intervalMinutes": _settings()["intervalMinutes"],
        "diskFreeGB": round(free_gb, 2),
        "logsRotated": rotated,
    }

    # 失败 → 冻结自我改代码（避免越修越坏）；全绿 → 解冻
    try:
        os.makedirs(os.path.dirname(frozen_path), exist_ok=True)
        if fails:
            with open(frozen_path, "w", encoding="utf-8") as f:
                json.dump({"at": result["at"], "fails": fails}, f, ensure_ascii=False)
        elif os.path.exists(frozen_path):
            os.remove(frozen_path)
    except Exception:
        pass

    try:
        with open(STATUS_FILE, "w", encoding="utf-8") as f:
            json.dump(result, f, ensure_ascii=False, indent=1)
    except Exception:
        pass
    try:
        with open(LOG_FILE, "a", encoding="utf-8") as f:
            f.write(json.dumps({
                "at": result["at"], "ok": result["ok"], "fails": result["fails"],
                "healed": healed,
                "steps": [{"name": x["name"], "code": x["code"], "seconds": x["seconds"]} for x in steps],
            }, ensure_ascii=False) + "\n")
    except Exception:
        pass
    return result



def fail_summary(result):
    """把失败项写成「名称：✗ 行」——只报 59/60 这种数字等于让她猜。"""
    parts = []
    for st in result.get("steps") or []:
        if st.get("code") == 0:
            continue
        name = st.get("name") or "未知项"
        detail = ""
        for line in (st.get("tail") or []):
            line = str(line).strip()
            if line.startswith("✗") or line.startswith("Traceback"):
                detail = line[:60]
                break
        parts.append("%s%s" % (name, ("：" + detail) if detail else ""))
    return "；".join(parts) if parts else "未知项"


def _notify(bot, result, cfg):
    if not cfg.get("notify"):
        return
    now = time.time()
    if now - _notify_last[0] < 3600:      # 一小时最多提醒一次
        return
    _notify_last[0] = now
    try:
        import engine as G
        if not G.MASTER_WXID:
            return
        target = bot.display_name(G.MASTER_WXID)
        bot.send_text("自检没过：%s。日志在 data/selfcheck.jsonl。"
                      % fail_summary(result)[:300], target, G.MASTER_WXID)
    except Exception:
        pass


def _loop(bot, cfg):
    import engine as G
    time.sleep(FIRST_DELAY)
    while True:
        try:
            result = run_checks()
            if result["ok"]:
                G.log('自检通过（%s）' % result["at"])
            else:
                # 先别打扰：改代码的中间态常常一条检查红、两分钟后自己绿（2026-11-22 凌晨踩过）
                G.log('自检失败（%s），90 秒后复核' % "、".join(result["fails"]))
                time.sleep(CONFIRM_DELAY)
                again = run_checks()
                if again["ok"]:
                    G.log('复核通过：刚才是瞬时状态，不通知主人')
                else:
                    G.log('复核仍失败：%s' % "、".join(again["fails"]))
                    _notify(bot, again, _settings())
        except Exception as e:
            try:
                G.log('自检异常（不影响聊天）：', repr(e))
                try:
                    import error_meter
                    error_meter.bump('selfcheck')
                except Exception:
                    pass
            except Exception:
                pass
        time.sleep(max(60, int(_settings()["intervalMinutes"]) * 60))


def start(bot):
    """由 BridgeRuntime.start() 调用；重复调用无副作用。"""
    if _started[0]:
        return
    cfg = _settings()
    if not cfg["enabled"]:
        try:
            import engine as G
            G.log('自检已关闭（config.selfcheck.enabled=false）')
        except Exception:
            pass
        return
    _started[0] = True
    t = threading.Thread(target=_loop, args=(bot, cfg), name="selfcheck", daemon=True)
    t.start()
    try:
        import engine as G
        G.log('定时自检已启动：每 %d 分钟一轮（首次 60 秒后）' % cfg["intervalMinutes"])
    except Exception:
        pass

# ------------------------------------------------------------------ 运维检查
LOG_MAX_MB = 5
LOG_KEEP = 3
DISK_WARN_GB = 2.0


def _rotate_logs():
    """单个日志超过 5MB 就轮转，最多留 3 份。返回轮转了几个。"""
    n = 0
    data = os.path.join(ROOT, "data")
    try:
        names = [f for f in os.listdir(data) if f.endswith(".log")]
    except Exception:
        return 0
    for name in names:
        p = os.path.join(data, name)
        try:
            if os.path.getsize(p) < LOG_MAX_MB * 1024 * 1024:
                continue
            for i in range(LOG_KEEP - 1, 0, -1):
                src = "%s.%d" % (p, i)
                dst = "%s.%d" % (p, i + 1)
                if os.path.exists(src):
                    if i + 1 > LOG_KEEP:
                        os.remove(src)
                    else:
                        os.replace(src, dst)
            os.replace(p, p + ".1")
            n += 1
        except Exception:
            pass
    return n


def _disk_free_gb():
    try:
        import shutil as _sh
        return _sh.disk_usage(ROOT).free / (1024 ** 3)
    except Exception:
        return -1.0

# ------------------------------------------------------------------ 记忆快照
SNAP_KEEP_DAYS = 7


def _daily_snapshot():
    """每天第一次自检时给记忆拍个快照，保留 7 天。坏了能回滚。"""
    import shutil as _sh
    src = os.path.join(ROOT, "data", "memory")
    dst = os.path.join(ROOT, "data", "backups", "memory-" + time.strftime("%Y%m%d"))
    if not os.path.isdir(src):
        return None
    if os.path.isdir(dst):
        return None
    try:
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        _sh.copytree(src, dst)
        return dst
    except Exception:
        return None


def _prune_backups(days=SNAP_KEEP_DAYS):
    """清理超过 N 天的快照和备份，返回删掉几个。"""
    import shutil as _sh
    base = os.path.join(ROOT, "data", "backups")
    if not os.path.isdir(base):
        return 0
    cutoff = time.time() - days * 86400
    cron_cutoff = time.time() - 48 * 3600   # cron 快照每 30 分钟一份，只留 48 小时
    n = 0
    for name in os.listdir(base):
        p = os.path.join(base, name)
        limit = cron_cutoff if name.endswith("-cron.json") else cutoff
        try:
            if os.path.getmtime(p) < limit:
                _sh.rmtree(p) if os.path.isdir(p) else os.remove(p)
                n += 1
        except Exception:
            pass
    return n
