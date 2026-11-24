# -*- coding: utf-8 -*-
"""统一动作审计（I-07）。

所有动作路径共用一个 JSONL schema：
  brain（执行脑 P1-P4）和 delegation（委托链）都写这里。
不替代原 brain-audit；先双写，后续再考虑收敛。
"""
import json
import os
import re
import threading
import time

SCHEMA_VERSION = 1
SECRET_RE = re.compile(r'sk-[A-Za-z0-9]{8,}|DEEPSEEK_API_KEY\s*[=:]\s*\S+', re.I)
_LOCK = threading.RLock()


def _clean(v, max_len=300):
    s = str(v or '')
    s = SECRET_RE.sub('sk-***', s)
    return s[:max_len]


def record(*, source, task_id='', chat='', action='', status='', risk='R0',
           mode='', goal='', reason='', duration_ms=0, evidence=None, path=None, at=None):
    row = {
        'v': SCHEMA_VERSION,
        'at': int(at if at is not None else time.time() * 1000),
        'source': _clean(source, 20),
        'taskId': _clean(task_id, 120),
        'chat': _clean(chat, 160),
        'action': _clean(action, 80),
        'status': _clean(status, 40),
        'risk': _clean(risk, 4),
        'mode': _clean(mode, 40),
        'goal': _clean(goal, 300),
        'reason': _clean(reason, 240),
        'durationMs': max(0, int(duration_ms or 0)),
        'evidence': [_clean(x, 200) for x in (evidence or [])][:20],
    }
    target = path or os.environ.get('WHALE_ACTION_AUDIT') or os.path.join(
        os.environ.get('WHALE_ROOT') or os.getcwd(), 'data', 'action-audit.jsonl')
    try:
        os.makedirs(os.path.dirname(target) or '.', exist_ok=True)
        with _LOCK:
            with open(target, 'a', encoding='utf-8') as f:
                f.write(json.dumps(row, ensure_ascii=False) + '\n')
    except Exception:
        return row
    return row


def read(path, limit=100):
    rows = []
    try:
        with open(path, encoding='utf-8') as f:
            for line in f:
                line = line.strip()
                if line:
                    try:
                        rows.append(json.loads(line))
                    except Exception:
                        pass
    except Exception:
        return []
    return rows[-max(1, int(limit)):]
