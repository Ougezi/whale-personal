# -*- coding: utf-8 -*-
"""文档自动同步：稳定参数进「参数块」（会被校验），实时状态进「状态块」（不校验）。

为什么要分两块：
    参数块放的是上限/开关/阈值——只有我们改代码或配置时才会变，可以直接参与自测。
    状态块放的是「现在偏好几条、心情多久前更新、今天改了几次代码」——每轮对话都在变，
    放进被校验的块里会让自测永远红（踩过两次：时间戳、mood 分钟数）。

用法：
    python 鲸鲸-文档同步.py            # 只校验参数块（漂移退出码 1）
    python 鲸鲸-文档同步.py --write    # 更新参数块和状态块
"""
import json
import os
import re
import sys
import time

ROOT = os.environ.get("WHALE_ROOT") or os.path.join(
    os.environ.get("LOCALAPPDATA") or os.path.join(os.path.expanduser("~"), "AppData", "Local"),
    "Programs", "WhaleGirl")
W = os.path.dirname(os.path.abspath(__file__))
DOCS = [
    os.path.join(W, "鲸鲸-记忆系统.md"),
    os.path.join(W, "鲸鲸-找图链路.md"),
    os.path.join(W, "鲸鲸-委托执行端.md"),
]
M_PARAM = "<!-- AUTO:params -->"
E_PARAM = "<!-- /AUTO:params -->"
M_STATE = "<!-- AUTO:state -->"
E_STATE = "<!-- /AUTO:state -->"

CONST_KEYS = [
    "dialogueBudget", "summaryTokens", "recentMaxTokens", "recentLowTokens",
    "maxMessagesPerChat", "rawRetentionDays", "eventRetentionDays",
    "maxPeoplePerChat", "maxTraitsPerPerson", "maxPreferencesPerPerson",
    "maxEventsPerPerson", "maxEventsPerChat", "retrievalTopK", "retrievalMinScore",
    "episodeIdleMinutes", "checkpointKeep",
]


def read_text(p):
    try:
        with open(p, encoding="utf-8") as f:
            return f.read()
    except Exception:
        return ""


def read_json(p, default=None):
    try:
        with open(p, encoding="utf-8-sig") as f:
            return json.load(f)
    except Exception:
        return default if default is not None else {}


def constants():
    out = {}
    src = read_text(os.path.join(ROOT, "src", "memory", "constants.js"))
    for k in CONST_KEYS:
        m = re.search(r"^\s{2}%s:\s*([0-9.]+)," % re.escape(k), src, re.M)
        if m:
            out[k] = float(m.group(1)) if "." in m.group(1) else int(m.group(1))
    return out


def master_wxid(cfg):
    try:
        return (cfg.get("persona", {}).get("master", {}).get("wxids") or [""])[0]
    except Exception:
        return ""


def master_card(cfg):
    wxid = master_wxid(cfg)
    if not wxid:
        return None
    base = os.path.join(ROOT, "data", "memory", "chats")
    try:
        for chat in os.listdir(base):
            ppl = os.path.join(base, chat, "people")
            if not os.path.isdir(ppl):
                continue
            for name in os.listdir(ppl):
                if not name.endswith(".json"):
                    continue
                d = read_json(os.path.join(ppl, name))
                if str(d.get("chatId") or "") == "wechat:u:" + wxid:
                    d["_chat"] = chat
                    return d
    except Exception:
        pass
    return None


def messages_of(chat):
    n = 0
    try:
        with open(os.path.join(ROOT, "data", "memory", "chats", chat, "messages.jsonl"),
                  encoding="utf-8") as f:
            for line in f:
                if line.strip():
                    n += 1
    except Exception:
        pass
    return n


def vector_state(cfg):
    model = os.path.join(ROOT, "data", "vector", "models", "Xenova", "bge-small-zh-v1.5",
                         "onnx", "model_quantized.onnx")
    installed = os.path.exists(model)
    return {
        "installed": installed,
        "model_mb": round(os.path.getsize(model) / 1024 / 1024, 1) if installed else 0,
        "cached": len(read_json(os.path.join(ROOT, "data", "vector", "event-vecs.json"))),
        "enabled": bool((cfg.get("features") or {}).get("vectorSearch")),
    }


def self_state():
    rules = read_json(os.path.join(ROOT, "data", "self", "rules.json"), {"rules": []})
    today = time.strftime("%Y-%m-%d")
    changes = 0
    p = os.path.join(ROOT, "data", "self", "changes.jsonl")
    try:
        with open(p, encoding="utf-8") as f:
            for line in f:
                if line.strip() and line.startswith('{"at": "%s' % today):
                    changes += 1
    except Exception:
        pass
    return {"rules": len(rules.get("rules") or []), "changes_today": changes}


def mood_state():
    d = read_json(os.path.join(ROOT, "data", "mood.json"), None)
    if not d:
        return None
    try:
        v = float(d.get("valence") or 0)
        a = float(d.get("arousal") or 0)
        e = float(d.get("energy") or 0)
        return {"v": round(v, 2), "a": round(a, 2), "e": round(e, 2)}
    except Exception:
        return None


def render_params(cfg):
    c = constants()
    feats = cfg.get("features") or {}
    mem_cfg = cfg.get("memory") or {}
    deleg = cfg.get("delegation") or {}
    pic = cfg.get("picture") or {}
    vec = vector_state(cfg)
    lines = [
        "> 本节由 `鲸鲸-文档同步.py` 自动生成（只放稳定值），不要手改。",
        "",
        "| 项 | 当前值 | 来源 |",
        "|---|---|---|",
        "| 对话预算 dialogueBudget | %s | config.memory |" % mem_cfg.get("dialogueBudget", "?"),
        "| 近期窗口 recentMaxTokens | %s | constants.js |" % c.get("recentMaxTokens", "?"),
        "| 摘要上限 summaryTokens | %s | constants.js |" % c.get("summaryTokens", "?"),
        "| 原文上限/会话 | %s 条 | constants.js |" % c.get("maxMessagesPerChat", "?"),
        "| 原文保留 | %s 天 | constants.js |" % c.get("rawRetentionDays", "?"),
        "| 事件保留 | %s 天 | constants.js |" % c.get("eventRetentionDays", "?"),
        "| 偏好/人 | %s | constants.js |" % c.get("maxPreferencesPerPerson", "?"),
        "| 性格/人 | %s | constants.js |" % c.get("maxTraitsPerPerson", "?"),
        "| 事件/人 | %s | constants.js |" % c.get("maxEventsPerPerson", "?"),
        "| 检索 topK / 最低分 | %s / %s | constants.js |" % (c.get("retrievalTopK", "?"), c.get("retrievalMinScore", "?")),
        "| 情绪开关 | %s | features.mood |" % ("开" if feats.get("mood", True) else "关"),
        "| 向量检索 | %s | features.vectorSearch |" % (
            ("开（模型 %s MB）" % vec["model_mb"]) if vec["enabled"] and vec["installed"]
            else ("开（未装模型）" if vec["enabled"] else "关")),
        "| 委托并发/每日上限 | %s / %s | config.delegation |" % (deleg.get("maxConcurrent", "?"), deleg.get("maxPerDay", "?")),
        "| 搜来的图保留 | %s 天 / %s 张 | config.picture |" % (pic.get("keepDays", "?"), pic.get("maxFiles", "?")),
        "| 自适应超时 | 小 %ss / 中 %ss / 大 %ss（上限） | config.delegation |"
        % (deleg.get("smallSeconds", "?"), deleg.get("mediumSeconds", "?"), deleg.get("timeout", "?")),
        "| 定时自检 | 每 %s 分钟 | config.selfcheck |" % ((cfg.get("selfcheck") or {}).get("intervalMinutes", "?")),
    ]
    return "\n".join(lines)


def render_state(cfg):
    card = master_card(cfg) or {}
    prefs = [p for p in (card.get("preferences") or []) if not p.get("deleted") and not p.get("superseded")]
    events = [e for e in (card.get("events") or []) if not e.get("deleted")]
    traits = [t for t in (card.get("traits") or []) if not t.get("deleted")]
    cap = [p for p in prefs if p.get("kind") == "capability" or p.get("source") == "manual_fix"]
    msgs = messages_of(card.get("_chat")) if card.get("_chat") else 0
    vec = vector_state(cfg)
    sf = self_state()
    mo = mood_state()
    lines = [
        "> 本节是实时状态（每次对话都可能变），只作参考，不参与自测校验。",
        "",
        "| 项 | 当前值 |",
        "|---|---|",
        "| 主人私聊消息 | %d 条 |" % msgs,
        "| 生效偏好 | %d 条（上限 %s） |" % (len(prefs), constants().get("maxPreferencesPerPerson", "?")),
        "| 生效性格 | %d 条 |" % len(traits),
        "| 生效事件 | %d 条 |" % len(events),
        "| 能力事实 | %d 条 |" % len(cap),
        "| 自我规则 | %d 条 |" % sf["rules"],
        "| 自我改代码 | 今日 %d 次 |" % sf["changes_today"],
        "| 向量缓存 | %d 条事件 |" % vec["cached"],
        "| 当前心情 | %s |" % (
            "valence %s / arousal %s / energy %s" % (mo["v"], mo["a"], mo["e"]) if mo else "还没有状态文件"),
    ]
    return "\n".join(lines)


def apply_block(text, start, end, block):
    if start not in text or end not in text:
        return None
    i = text.index(start) + len(start)
    j = text.index(end, i)
    return text[:i] + "\n" + block + "\n" + text[j:]


def main():
    write = "--write" in sys.argv
    cfg = read_json(os.path.join(ROOT, "data", "config.json"))
    params = render_params(cfg)
    state = render_state(cfg)

    def pass_once(do_write, verbose=True):
        drift, missing = 0, 0
        for doc in DOCS:
            if not os.path.exists(doc):
                continue
            text = read_text(doc)
            if M_PARAM not in text or E_PARAM not in text:
                missing += 1
                if verbose:
                    print("  [缺参数标记] %s" % os.path.basename(doc))
                continue
            expected = apply_block(text, M_PARAM, E_PARAM, params)
            changed = expected != text
            if changed:
                drift += 1
                if verbose:
                    print("  [参数漂移] %s" % os.path.basename(doc))
                if do_write:
                    text = expected
            if do_write and M_STATE in text and E_STATE in text:
                text = apply_block(text, M_STATE, E_STATE, state) or text
            if do_write and (changed or (M_STATE in text)):
                open(doc, "w", encoding="utf-8", newline="\n").write(text)
            elif not changed and verbose:
                print("  [一致] %s" % os.path.basename(doc))
        return drift, missing

    drift, missing = pass_once(write)
    if write and drift:
        # --write 写完之后必须复检：按写入**后**的状态返回退出码，
        # 否则「写成功了却返回 1」——自愈会被误判成失败（踩过）
        drift, missing = pass_once(False, verbose=False)
        print("  已写回并复检：%s" % ("一致" if drift == 0 and missing == 0 else "仍有漂移"))
    elif drift:
        print("\n有 %d 份文档参数漂移：加 --write。" % drift)
    return 0 if (drift == 0 and missing == 0) else 1


if __name__ == "__main__":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass
    sys.exit(main())
