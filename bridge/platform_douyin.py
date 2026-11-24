# -*- coding: utf-8 -*-
"""P0 · 抖音只读 adapter：包装现有 douyin_agent / sidecar，不重写协议。"""
import hashlib
import json

try:
    import douyin_agent
except Exception:
    douyin_agent = None

READ_OPS = {'hot', 'watch', 'user', 'search_users', 'comments', 'download', 'live',
            'report', 'recent', 'accounts', 'collection', 'link', 'status'}
WRITE_OPS = {'like', 'collect', 'comment'}


class DouyinAdapter:
    platform = 'douyin'

    def available(self):
        ok = bool(douyin_agent and douyin_agent.available())
        return {'ok': ok, 'sidecar': bool(douyin_agent), 'node': ok}

    def capabilities(self):
        return [{'op': op, 'risk': 'R1' if op not in WRITE_OPS else 'R2'} for op in sorted(READ_OPS | WRITE_OPS)]

    def execute(self, op, args=None, approved=False):
        if op in WRITE_OPS and not approved:
            return {'ok': False, 'code': 'approval-required', 'text': '抖音写操作需要 R2 审批', 'evidence': {}}
        if op not in READ_OPS | WRITE_OPS:
            return {'ok': False, 'code': 'unknown-op', 'text': '未知抖音操作', 'evidence': {}}
        if not douyin_agent:
            return {'ok': False, 'code': 'unavailable', 'text': '抖音模块没加载', 'evidence': {}}
        try:
            call_args = dict(args or {})
            if op == 'comment':
                call_args['confirm'] = True
            out = douyin_agent._call(op, call_args, timeout=240 if op in ('watch', 'hot', 'download', 'user', 'comments', 'live', 'collection', 'search_users') else 60)
        except Exception as e:
            return {'ok': False, 'code': 'exception', 'text': '抖音调用异常：%s' % str(e)[:160], 'evidence': {}}
        ok = bool(out.get('ok'))
        text = str(out.get('text') or '没拿到内容')
        raw = json.dumps(out, ensure_ascii=False, sort_keys=True)
        return {
            'ok': ok,
            'data': out,
            'text': text,
            'code': '' if ok else str(out.get('code') or 'failed'),
            'evidence': {
                'readback': 'douyin:%s:%s:%s' % (op, len(raw), hashlib.sha256(raw.encode('utf-8')).hexdigest()[:12]),
                'tests': ['sidecar-ok'] if ok else ['sidecar-failed'],
                'source': 'whale-douyin/service.mjs',
            },
        }
