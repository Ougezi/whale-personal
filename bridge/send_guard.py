# -*- coding: utf-8 -*-
"""I-03：发送口 Command Bus / 回执。

默认关（WHALE_SEND_GUARD!=1）。
开启后：
  - target 白名单（WHALE_SEND_TARGETS，分号分隔；空=只要求非空）；
  - 同 target+text 5 秒内重复 -> 拒绝；
  - 每次发送写一行 receipt（success/failed），不存全文，只存预览/hash。
失败只影响本条发送，不碰旧发送链。
"""
import hashlib
import json
import os
import time

MAX_PREVIEW = 80
DEDUPE_MS = 5000


class SendBlocked(Exception):
    pass


class SendGuard:
    def __init__(self, allowed_targets=None, receipt_file=None, now=None):
        self.allowed = set(allowed_targets or [])
        self.receipt_file = receipt_file
        self.now = now or (lambda: int(time.time() * 1000))
        self.seen = {}
        self.rows = []

    def allow(self, target, text):
        tgt = str(target or '').strip()
        body = str(text or '')
        if not tgt:
            return {'ok': False, 'reason': 'target-required'}
        if self.allowed and tgt not in self.allowed:
            return {'ok': False, 'reason': 'target-not-allowed'}
        ts = self.now()
        key = hashlib.sha256((tgt + '\n' + body).encode('utf-8')).hexdigest()[:24]
        if self.seen.get(key, 0) and ts - self.seen[key] < DEDUPE_MS:
            return {'ok': False, 'reason': 'duplicate'}
        self.seen[key] = ts
        return {'ok': True, 'key': key, 'target': tgt}

    def receipt(self, target, text, ok, reason=''):
        row = {
            'at': self.now(), 'target': str(target or '')[:120],
            'ok': bool(ok), 'reason': str(reason or '')[:120],
            'preview': str(text or '')[:MAX_PREVIEW],
            'hash': hashlib.sha256(str(text or '').encode('utf-8')).hexdigest()[:16],
        }
        self.rows.append(row)
        if self.receipt_file:
            try:
                os.makedirs(os.path.dirname(self.receipt_file) or '.', exist_ok=True)
                with open(self.receipt_file, 'a', encoding='utf-8') as f:
                    f.write(json.dumps(row, ensure_ascii=False) + '\n')
            except Exception:
                pass
        return row


def _guard_from_env(G):
    if os.environ.get('WHALE_SEND_GUARD') != '1':
        return None
    raw = os.environ.get('WHALE_SEND_TARGETS', '').strip()
    allowed = [x.strip() for x in raw.split(';') if x.strip()]
    file = os.path.join(getattr(G, 'ROOT', os.getcwd()), 'data', 'send-receipts.jsonl')
    return SendGuard(allowed_targets=allowed, receipt_file=file)


def get_guard(G=None):
    if G is None:
        import engine as G
    guard = getattr(G, 'SEND_GUARD', None)
    if guard is None and os.environ.get('WHALE_SEND_GUARD') == '1':
        guard = _guard_from_env(G)
        try:
            G.SEND_GUARD = guard
        except Exception:
            pass
    return guard
