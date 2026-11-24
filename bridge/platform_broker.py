# -*- coding: utf-8 -*-
"""P0/P1 · 平台统一调用方。

消息里的 [[gh:...]] / [[bili:...]] 进入这里；能力检查、风险检查、shadow、
adapter、verify、receipt。只读优先；R2/R3 没有 approved 一律拒绝。
"""
import hashlib
import json
import os
import time

try:
    from .verify import Verifier
    from .shadow import Shadow
    from .evolution.approval import Approval
except Exception:
    from verify import Verifier
    from shadow import Shadow
    from evolution.approval import Approval


class BrokerError(Exception):
    pass


class PlatformBroker:
    def __init__(self, adapters=None, verifier=None, audit=None, shadow=None, receipt_path=None,
                 writes_enabled=False, owner='ougezi', birth=None, rollout=None):
        self.adapters = dict(adapters or {})
        self.verifier = verifier if verifier is not None else Verifier(audit=audit)
        self.audit = audit
        # P1：传 Shadow 时只记录，不执行（真正的 shadow）
        self.shadow = shadow
        self.receipt_path = receipt_path
        self.writes_enabled = bool(writes_enabled)
        self.owner = str(owner or 'ougezi')
        self.approvals = {}
        self.birth = birth
        self.rollout = rollout

    def available(self):
        out = {}
        for name, a in self.adapters.items():
            try:
                out[name] = bool(a.available().get('ok'))
            except Exception:
                out[name] = False
        return out

    def capabilities(self):
        out = {}
        for name, a in self.adapters.items():
            try:
                out[name] = a.capabilities()
            except Exception:
                out[name] = []
        return out

    def _cap(self, platform, op):
        for c in self.adapters[platform].capabilities():
            if c.get('op') == op:
                return c
        return None

    def request_write(self, platform, op, args=None):
        cap = self._cap(platform, op) if platform in self.adapters else None
        if not cap or cap.get('risk') not in ('R2', 'R3'):
            return {'ok': False, 'code': 'not-write', 'text': '不是可写操作'}
        if not self.writes_enabled:
            return {'ok': False, 'code': 'write-disabled', 'text': '平台写操作未开启（WHALE_PLATFORM_WRITES=1）'}
        import time as _t
        rid = 'pw-%d' % int(_t.time() * 1000)
        ap = Approval(rid, risk=cap.get('risk'), action='%s.%s' % (platform, op), evidence=[json.dumps(args or {}, ensure_ascii=False)])
        self.approvals[rid] = {'approval': ap, 'platform': platform, 'op': op, 'args': args or {}}
        return {'ok': True, 'id': rid, 'required': ap.required, 'state': ap.state,
                'approval': ap.snapshot()}

    def approve_write(self, approval_id, approver):
        rec = self.approvals.get(str(approval_id or ''))
        if not rec:
            return {'ok': False, 'code': 'not-found', 'text': '没有这个审批'}
        who = str(approver or '').strip()
        if who != self.owner:
            return {'ok': False, 'code': 'wrong-approver', 'text': '只有主人可以批准'}
        rec['approval'].approve(who)
        return {'ok': True, 'id': approval_id, 'state': rec['approval'].state, 'approval': rec['approval'].snapshot()}

    def pending_writes(self):
        return [{'id': k, 'platform': v['platform'], 'op': v['op'],
                 'state': v['approval'].state, 'required': v['approval'].required}
                for k, v in self.approvals.items() if v['approval'].state != 'approved']

    def _approved(self, approval_id, platform, op):
        rec = self.approvals.get(str(approval_id or ''))
        if not rec:
            return False
        if rec['platform'] != platform or rec['op'] != op:
            return False
        return rec['approval'].state == 'approved'

    def _receipt(self, row):
        if not self.receipt_path:
            return
        try:
            os.makedirs(os.path.dirname(self.receipt_path), exist_ok=True)
            with open(self.receipt_path, 'a', encoding='utf-8') as f:
                f.write(json.dumps(row, ensure_ascii=False) + '\n')
        except Exception:
            pass

    def dispatch(self, platform, op, args=None, *, approved=False, action_id=None, chat='', approval_id=None):
        platform = str(platform or '').strip()
        op = str(op or '').strip()
        if platform not in self.adapters:
            return {'ok': False, 'code': 'unknown-platform', 'text': '没有这个平台：' + platform}
        adapter = self.adapters[platform]
        cap = self._cap(platform, op)
        if not cap:
            return {'ok': False, 'code': 'unknown-op', 'text': '未知操作：%s.%s' % (platform, op)}
        risk = str(cap.get('risk') or 'R1')
        if self.birth is not None:
            try:
                if not (self.birth.skills or {}).get('dsh', True):
                    return {'ok': False, 'code': 'skill-disabled', 'text': '动手技能已关闭'}
            except Exception:
                pass
        if self.rollout is not None:
            try:
                pct = int((self.rollout or {}).get(platform, 100))
            except Exception:
                pct = 100
            if pct < 100:
                bucket = int(hashlib.sha1((str(chat) + ':' + platform + ':' + op).encode('utf-8')).hexdigest()[:8], 16) % 100
                if bucket >= pct:
                    return {'ok': False, 'code': 'rollout-blocked', 'text': '%s 当前灰度 %d%%，这次不在窗口' % (platform, pct)}
        if risk in ('R2', 'R3'):
            if not self.writes_enabled:
                return {'ok': False, 'code': 'write-disabled', 'text': '平台写操作未开启（WHALE_PLATFORM_WRITES=1）'}
            if not (approved and self._approved(approval_id, platform, op)):
                return {'ok': False, 'code': 'approval-required', 'text': '%s.%s 需要 %s 审批' % (platform, op, risk)}
        if self.shadow is not None:
            try:
                self.shadow.record(chat=chat, text=json.dumps(args or {}, ensure_ascii=False)[:500],
                                   action='%s.%s' % (platform, op), risk=risk,
                                   shouldExecute=True, reason='platform-shadow')
            except Exception:
                pass
            return {'ok': True, 'shadow': True, 'text': '已记录 shadow，未执行：%s.%s' % (platform, op),
                    'platform': platform, 'op': op, 'risk': risk}
        try:
            out = adapter.execute(op, args or {}, approved=approved) if platform == 'douyin' else adapter.execute(op, args or {})
        except Exception as e:
            out = {'ok': False, 'code': 'adapter-exception', 'text': '%s 调用异常：%s' % (platform, str(e)[:160]), 'evidence': {}}
        out = dict(out or {})
        out['platform'] = platform
        out['op'] = op
        out['risk'] = risk
        out['chat'] = str(chat or '')[:120]
        if out.get('ok'):
            aid = str(action_id or 'platform:%s:%s:%d' % (platform, op, int(time.time() * 1000)))
            try:
                vr = self.verifier.verify(action_id=aid, action='%s.%s' % (platform, op), evidence=out.get('evidence') or {})
                out['receipt'] = vr.get('receipt')
                if vr.get('receipt', {}).get('state') != 'success':
                    out['ok'] = False
                    out['code'] = 'verify-failed'
                    out['text'] = '结果没有通过证据校验：' + str(vr.get('receipt', {}).get('reason') or '')
            except Exception as e:
                out['ok'] = False
                out['code'] = 'verify-error'
                out['text'] = '证据校验异常：' + str(e)[:160]
        if out.get('receipt'):
            self._receipt({'at': int(time.time() * 1000), 'actionId': out['receipt'].get('actionId'),
                           'platform': platform, 'op': op, 'state': out['receipt'].get('state'),
                           'reason': out['receipt'].get('reason') or '',
                           'readback': (out.get('evidence') or {}).get('readback') or ''})
        if callable(self.audit):
            try:
                self.audit({'platform': platform, 'op': op, 'ok': bool(out.get('ok')),
                            'code': out.get('code') or '', 'at': int(time.time() * 1000)})
            except Exception:
                pass
        return out

    def dispatch_spec(self, spec, chat=''):
        """gh:repo:owner/name / bili:view:BV... → dispatch。"""
        s = str(spec or '').strip()
        if ':' not in s:
            return {'ok': False, 'code': 'bad-spec', 'text': '标记格式不对'}
        platform, rest = s.split(':', 1)
        if platform not in ('github', 'bilibili'):
            platform = {'gh': 'github', 'bili': 'bilibili'}.get(platform, platform)
        if ':' not in rest:
            return {'ok': False, 'code': 'bad-spec', 'text': '标记缺少操作'}
        op, tail = rest.split(':', 1)
        args = _args_for(platform, op, tail)
        if args is None:
            return {'ok': False, 'code': 'bad-spec', 'text': '标记参数不对'}
        return self.dispatch(platform, op, args, chat=chat)


def _args_for(platform, op, tail):
    tail = str(tail or '').strip()
    if platform == 'github':
        parts = tail.split(':')
        repo = parts[0] if parts else ''
        if op in ('repo', 'readme', 'issues', 'pulls', 'actions', 'release'):
            return {'repo': repo}
        if op in ('issue', 'pull'):
            return {'repo': repo, 'number': int(parts[1]) if len(parts) > 1 and parts[1].isdigit() else 0}
    if platform == 'bilibili':
        if op in ('view', 'comments'):
            return {'bvid': tail.split()[0] if tail else ''}
        if op == 'search':
            return {'keyword': tail}
        if op == 'user':
            return {'mid': tail.split()[0] if tail else ''}
    return None
