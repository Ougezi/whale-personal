# -*- coding: utf-8 -*-
"""桥接异常计数：静默吞可以，但要能看见（2026-11 架构审查）。

计数写 data/bridge-errors.json，内核 /api/health 会读它一起展示。
只统计，不改行为；写盘失败也不影响主流程。
"""
import json
import os
import threading
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PATH = os.path.join(ROOT, "data", "bridge-errors.json")
_lock = threading.Lock()
_counts = {}
_last_flush = [0.0]


def bump(tag):
    key = str(tag or "unknown")[:40]
    with _lock:
        _counts[key] = _counts.get(key, 0) + 1
        now = time.time()
        if now - _last_flush[0] > 30:
            _last_flush[0] = now
            _flush_locked()


def _flush_locked():
    try:
        top = sorted(_counts.items(), key=lambda x: -x[1])[:10]
        payload = {"at": time.strftime("%Y-%m-%d %H:%M:%S"),
                   "total": sum(_counts.values()), "top": dict(top)}
        with open(PATH, "w", encoding="utf-8") as f:
            json.dump(payload, f, ensure_ascii=False)
    except Exception:
        pass


def flush():
    with _lock:
        _flush_locked()


def stats():
    with _lock:
        return {"total": sum(_counts.values()),
                "top": dict(sorted(_counts.items(), key=lambda x: -x[1])[:10])}
