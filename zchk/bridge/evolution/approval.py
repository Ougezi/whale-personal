# -*- coding: utf-8 -*-
"""出生技能 · 主人审批与灰度（B4-04）。

影子 → canary → live：
  - R2 需 1 个主人批准，R3 需 2 个；
  - 未批不能 canary/live；
  - canary 指标不达标自动回滚；
  - 任意阶段可 stop。
"""
APPROVALS = {'R0': 0, 'R1': 0, 'R2': 1, 'R3': 2}
GATE = {'score': 0.85, 'errorRate': 0.01}


class ApprovalError(Exception):
    pass


class Approval:
    def __init__(self, request_id, risk='R2', action='', evidence=None, audit=None):
        if risk not in APPROVALS:
            raise ApprovalError('bad risk')
        self.id = request_id
        self.risk = risk
        self.action = action
        self.evidence = list(evidence or [])
        self.approvals = []
        self.required = APPROVALS[risk]
        self.state = 'pending' if self.required else 'approved'
        self.stage = 'shadow'
        self.history = []
        self.audit = audit
        self._log('request', risk=risk)

    def _log(self, action, **kw):
        row = {'id': self.id, 'action': action, 'state': self.state, 'stage': self.stage, **kw}
        self.history.append(row)
        if callable(self.audit):
            try:
                self.audit(row)
            except Exception:
                pass

    def approve(self, approver):
        if self.state == 'stopped':
            raise ApprovalError('stopped')
        who = str(approver or '').strip()
        if not who:
            raise ApprovalError('approver required')
        if who not in self.approvals:
            self.approvals.append(who)
        if len(self.approvals) >= self.required:
            self.state = 'approved'
        self._log('approve', approver=who, count=len(self.approvals))
        return self.snapshot()

    def enter_canary(self):
        if self.state != 'approved':
            raise ApprovalError('not approved')
        if not self.evidence:
            raise ApprovalError('evidence required')
        self.stage = 'canary'
        self._log('canary')
        return self.snapshot()

    def promote_live(self, metrics=None):
        if self.state != 'approved':
            raise ApprovalError('not approved')
        if self.stage != 'canary':
            raise ApprovalError('not in canary')
        m = metrics or {}
        if m.get('score', 0) < GATE['score'] or m.get('errorRate', 1) > GATE['errorRate']:
            self.rollback('metrics')
            return {'ok': False, 'reason': 'metrics', **self.snapshot()}
        self.stage = 'live'
        self._log('live')
        return {'ok': True, **self.snapshot()}

    def rollback(self, reason='manual'):
        self.stage = 'shadow'
        self._log('rollback', reason=reason)
        return {'ok': True, 'stage': self.stage, 'reason': reason}

    def stop(self):
        self.state = 'stopped'
        self.stage = 'shadow'
        self._log('stop')
        return self.snapshot()

    def snapshot(self):
        return {'id': self.id, 'risk': self.risk, 'state': self.state, 'stage': self.stage,
                'approvals': list(self.approvals), 'required': self.required,
                'evidence': len(self.evidence), 'history': list(self.history)}
