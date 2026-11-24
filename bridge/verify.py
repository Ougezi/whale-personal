# -*- coding: utf-8 -*-
"""出生技能 · 验证/回执/审计（B3-04）。

动作完成不是“我说完成了”，而是：
  - 读回/测试/diff 证据；
  - 生成 receipt（success/failed/timeout）；
  - 失败必须带可解释 reason；
  - 写审计。
"""
import time

STATES = {'success', 'failed', 'timeout'}


class VerifyError(Exception):
    pass


class Verifier:
    def __init__(self, audit=None):
        self.receipts = {}
        self.audit = audit
        self.history = []

    def verify(self, *, action_id, action='', evidence=None, timed_out=False, at=None):
        if not action_id:
            raise VerifyError('action_id required')
        if action_id in self.receipts:
            return {'duplicate': True, 'receipt': dict(self.receipts[action_id])}
        now = int(at if at is not None else time.time() * 1000)
        ev = evidence or {}
        state = 'success'
        reason = ''
        if timed_out:
            state, reason = 'timeout', 'timeout'
        elif not ev:
            state, reason = 'failed', 'no-evidence'
        elif not ev.get('readback'):
            state, reason = 'failed', 'no-readback'
        elif not isinstance(ev.get('tests'), list) or not ev.get('tests') or not all(ev['tests']):
            state, reason = 'failed', 'tests-failed'
        receipt = {'actionId': action_id, 'action': str(action)[:80], 'state': state,
                   'evidence': ev, 'reason': reason, 'at': now}
        self.receipts[action_id] = receipt
        self.history.append({'action': 'receipt', 'actionId': action_id, 'state': state, 'reason': reason, 'at': now})
        if callable(self.audit):
            try:
                self.audit(self.history[-1])
            except Exception:
                pass
        return {'duplicate': False, 'receipt': dict(receipt)}

    def task_card(self, action_id):
        r = self.receipts.get(action_id)
        if not r:
            return {'ok': False, 'reason': 'no-receipt'}
        return {'ok': True, 'title': r['action'] or r['actionId'], 'status': r['state'],
                'reason': r['reason'], 'evidence': r['evidence'], 'at': r['at']}

    def coverage(self, expected):
        n = int(expected)
        if n <= 0:
            return 1.0
        return min(1.0, len(self.receipts) / n)

    def stats(self):
        out = {'success': 0, 'failed': 0, 'timeout': 0}
        for r in self.receipts.values():
            out[r['state']] = out.get(r['state'], 0) + 1
        return {'total': len(self.receipts), **out}
