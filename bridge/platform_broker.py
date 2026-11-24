# -*- coding: utf-8 -*-
"""P0 · 平台统一调用方。

消息里的 [[gh:...]] / [[bili:...]] 进入这里；先能力检查、风险检查、adapter、
verify、receipt。只读优先；R2/R3 没有 approved 一律拒绝。
"""
import json
import time

try:
    from .verify import Verifier
except Exception:
    from verify import Verifier


class BrokerError(Exception):
    pass


class PlatformBroker:
    def __init__(self, adapters=None, verifier=None, audit=None):
        self.adapters = dict(adapters or {})
        self.verifier = verifier if verifier is not None else Verifier(audit=audit)
        self.audit = audit

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

    def dispatch(self, platform, op, args=None, *, approved=False, action_id=None):
        platform = str(platform or '').strip()
        op = str(op or '').strip()
        if platform not in self.adapters:
            return {'ok': False, 'code': 'unknown-platform', 'text': '没有这个平台：' + platform}
        adapter = self.adapters[platform]
        cap = self._cap(platform, op)
        if not cap:
            return {'ok': False, 'code': 'unknown-op', 'text': '未知操作：%s.%s' % (platform, op)}
        risk = str(cap.get('risk') or 'R1')
        if risk in ('R2', 'R3') and not approved:
            return {'ok': False, 'code': 'approval-required', 'text': '%s.%s 需要 %s 审批' % (platform, op, risk)}
        try:
            out = adapter.execute(op, args or {}, approved=approved) if platform == 'douyin' else adapter.execute(op, args or {})
        except Exception as e:
            out = {'ok': False, 'code': 'adapter-exception', 'text': '%s 调用异常：%s' % (platform, str(e)[:160]), 'evidence': {}}
        out = dict(out or {})
        out['platform'] = platform
        out['op'] = op
        out['risk'] = risk
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
        if callable(self.audit):
            try:
                self.audit({'platform': platform, 'op': op, 'ok': bool(out.get('ok')),
                            'code': out.get('code') or '', 'at': int(time.time() * 1000)})
            except Exception:
                pass
        return out

    def dispatch_spec(self, spec):
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
        return self.dispatch(platform, op, args)


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
