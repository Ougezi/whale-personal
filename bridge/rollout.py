# -*- coding: utf-8 -*-
"""出生技能 · 灰度与回滚（B6-03）。

10% → 50% → 100%；随时 kill；回滚 <5min；数据不丢。
只做发布控制状态，不直接改线上配置。
"""
import time

STAGES = [10, 50, 100]
ROLLBACK_BUDGET_MS = 5 * 60 * 1000


class RolloutError(Exception):
    pass


class Rollout:
    def __init__(self, stages=None, audit=None, now=None):
        self.stages = list(stages or STAGES)
        self.percent = 0
        self.enabled = True
        self.killed = False
        self.data = []
        self.history = []
        self.audit = audit
        self.now = now or (lambda: int(time.time() * 1000))

    def _log(self, action, **kw):
        row = {'action': action, 'percent': self.percent, 'at': self.now(), **kw}
        self.history.append(row)
        if callable(self.audit):
            try:
                self.audit(row)
            except Exception:
                pass

    def advance(self, metrics=None):
        if self.killed or not self.enabled:
            raise RolloutError('stopped')
        if self.percent >= self.stages[-1]:
            raise RolloutError('already full')
        m = metrics or {}
        if m.get('errorRate', 0) > 0.01 or m.get('score', 1) < 0.85:
            self._log('blocked', reason='metrics')
            return {'ok': False, 'reason': 'metrics', 'percent': self.percent}
        nxt = next(s for s in self.stages if s > self.percent)
        self.percent = nxt
        self._log('advance', to=nxt)
        return {'ok': True, 'percent': self.percent}

    def kill(self, reason='manual'):
        self.enabled = False
        self.killed = True
        prev = self.percent
        self.percent = 0
        self._log('kill', reason=reason, previous=prev)
        return {'ok': True, 'percent': 0, 'previous': prev, 'data': len(self.data)}

    def rollback(self, at=None):
        started = self.now()
        at = started if at is None else int(at)
        prev = self.percent
        self.percent = 0
        self.enabled = False
        self.killed = True
        duration = max(0, at - started)
        self._log('rollback', previous=prev, durationMs=duration, data=len(self.data))
        return {'ok': duration <= ROLLBACK_BUDGET_MS, 'previous': prev, 'percent': 0,
                'durationMs': duration, 'budgetMs': ROLLBACK_BUDGET_MS, 'data': len(self.data)}

    def add_data(self, item):
        self.data.append(item)
        return len(self.data)

    def snapshot(self):
        return {'percent': self.percent, 'enabled': self.enabled, 'killed': self.killed,
                'data': len(self.data), 'history': list(self.history)}
