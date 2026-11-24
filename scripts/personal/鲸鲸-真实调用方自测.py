# -*- coding: utf-8 -*-
"""P0 真实调用方：离线 24 检查（GitHub/B站/抖音/Broker/标记）。"""
import base64
import json
import os
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(ROOT, 'bridge'))

import platform_agent
import platform_broker
import platform_bilibili
import platform_github
import platform_douyin
from platform_douyin import DouyinAdapter
from shadow import Shadow

PASS = 0
FAIL = 0


def check(name, fn):
    global PASS, FAIL
    try:
        fn()
        PASS += 1
        print('  ✓ ' + name)
    except Exception as e:
        FAIL += 1
        print('  ✗ ' + name + '  ' + str(e))


def gh_fetch(url):
    if url.endswith('/readme'):
        raw = json.dumps({'name': 'README.md', 'content': base64.b64encode(b'# hello').decode()})
    elif '/issues?' in url:
        raw = json.dumps([{'number': 1, 'title': 'bug'}])
    elif '/issues/' in url:
        raw = json.dumps({'number': 1, 'title': 'bug', 'state': 'open'})
    elif '/pulls?' in url:
        raw = json.dumps([{'number': 2, 'title': 'pr'}])
    elif '/pulls/' in url:
        raw = json.dumps({'number': 2, 'title': 'pr', 'state': 'open'})
    elif '/actions/runs' in url:
        raw = json.dumps({'workflow_runs': [{'name': 'ci', 'conclusion': 'success'}]})
    elif '/releases/' in url:
        raw = json.dumps({'tag_name': 'v1.0', 'name': 'release'})
    else:
        raw = json.dumps({'full_name': 'o/r', 'stargazers_count': 1, 'language': 'Python', 'description': 'd'})
    return 200, raw, ''


def bili_fetch(url):
    if '/nav' in url:
        return 200, json.dumps({'code': -101, 'data': {'wbi_img': {'img_url': 'https://i0.hdslb.com/bfs/wbi/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.png', 'sub_url': 'https://i0.hdslb.com/bfs/wbi/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.png'}}}), ''
    if '/wbi/search/type' in url:
        return 200, json.dumps({'code': 0, 'data': {'result': [{'title': '<em>t</em>'}]}}), ''
    if '/view?' in url:
        return 200, json.dumps({'code': 0, 'data': {'bvid': 'BV1xx411c7mD', 'aid': 1, 'title': 't', 'owner': {'name': 'u'}, 'stat': {'view': 1}, 'desc': 'd'}}), ''
    if '/search/type' in url:
        return 200, json.dumps({'code': 0, 'data': {'result': [{'title': '<em>t</em>'}]}}), ''
    if '/x/v2/reply' in url:
        return 200, json.dumps({'code': 0, 'data': {'replies': [{'content': {'message': 'm'}}]}}), ''
    if '/card?' in url:
        return 200, json.dumps({'code': 0, 'data': {'card': {'name': 'u'}, 'fans': 3}}), ''
    return 200, json.dumps({'code': 0, 'data': {}}), ''


class FakeAdapter:
    def __init__(self, risk='R1'):
        self.risk = risk
        self.calls = []

    def available(self):
        return {'ok': True}

    def capabilities(self):
        return [{'op': 'x', 'risk': self.risk}]

    def execute(self, op, args=None, approved=False):
        self.calls.append((op, args, approved))
        return {'ok': True, 'text': 'ok', 'evidence': {'readback': 'r', 'tests': ['t']}}


def main():
    print('GitHub adapter')
    g = platform_github.GitHubAdapter(fetch=gh_fetch)
    for op, args in [('repo', {'repo': 'o/r'}), ('readme', {'repo': 'o/r'}), ('issues', {'repo': 'o/r'}),
                     ('issue', {'repo': 'o/r', 'number': 1}), ('pulls', {'repo': 'o/r'}),
                     ('pull', {'repo': 'o/r', 'number': 2}), ('actions', {'repo': 'o/r'}),
                     ('release', {'repo': 'o/r'})]:
        check('GH-' + op, lambda op=op, args=args: (_ for _ in ()).throw(AssertionError('bad')) if not g.execute(op, args).get('ok') else None)
    check('GH-404', lambda: (_ for _ in ()).throw(AssertionError('bad')) if platform_github.GitHubAdapter(fetch=lambda u: (404, '', 'x')).execute('repo', {'repo': 'o/r'}).get('code') != 'not-found' else None)
    print('B站 adapter')
    b = platform_bilibili.BilibiliAdapter(fetch=bili_fetch)
    for op, args in [('view', {'bvid': 'BV1xx411c7mD'}), ('search', {'keyword': 'k'}),
                     ('comments', {'bvid': 'BV1xx411c7mD'}), ('user', {'mid': '1'})]:
        check('BL-' + op, lambda op=op, args=args: (_ for _ in ()).throw(AssertionError('bad')) if not b.execute(op, args).get('ok') else None)
    check('BL-412', lambda: (_ for _ in ()).throw(AssertionError('bad')) if platform_bilibili.BilibiliAdapter(fetch=lambda u: (412, '', 'x')).execute('view', {'bvid': 'BV1xx411c7mD'}).get('code') != 'risk-control' else None)
    print('Broker')
    v = platform_broker.PlatformBroker({'github': platform_github.GitHubAdapter(fetch=gh_fetch), 'bilibili': b})
    check('broker github', lambda: (_ for _ in ()).throw(AssertionError('bad')) if not v.dispatch('github', 'repo', {'repo': 'o/r'}).get('ok') else None)
    check('broker receipt', lambda: (_ for _ in ()).throw(AssertionError('bad')) if v.dispatch('github', 'repo', {'repo': 'o/r'}).get('receipt', {}).get('state') != 'success' else None)
    check('broker unknown', lambda: (_ for _ in ()).throw(AssertionError('bad')) if v.dispatch('github', 'nope', {}).get('code') != 'unknown-op' else None)
    check('broker spec', lambda: (_ for _ in ()).throw(AssertionError('bad')) if not v.dispatch_spec('gh:repo:o/r').get('ok') else None)
    print('Risk / marker')
    os.environ.pop('WHALE_PLATFORM_CALLS', None)
    check('marker off', lambda: (_ for _ in ()).throw(AssertionError('bad')) if platform_agent.extract('[[gh:repo:o/r]]')[1] else None)
    os.environ['WHALE_PLATFORM_CALLS'] = '1'
    clean, spec = platform_agent.extract('[[gh:repo:o/r]]')
    check('marker on', lambda: (_ for _ in ()).throw(AssertionError('bad')) if spec != 'gh:repo:o/r' or 'gh:' in clean else None)
    os.environ.pop('WHALE_PLATFORM_CALLS', None)
    check('Douyin comment needs approval', lambda: (_ for _ in ()).throw(AssertionError('bad')) if DouyinAdapter().execute('comment', {}, approved=False).get('code') != 'approval-required' else None)
    _orig_call = platform_douyin.douyin_agent._call
    platform_douyin.douyin_agent._call = lambda op, args, timeout=None: {'ok': False, 'code': 'ops-disabled', 'text': 'sidecar disabled'}
    _ext = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), '..', '..', 'plugins', 'dsh-douyin-watch', 'lib', 'surfaces', 'ext.js')
    _ext = os.path.normpath(_ext)
    if os.path.exists(_ext):
        _src = open(_ext, encoding='utf-8').read()
        check('Douyin comment adapter source', lambda: (_ for _ in ()).throw(AssertionError('bad')) if 'ops_comment' not in _src or 'runComment' not in _src else None)
    check('Douyin comment forwards', lambda: (_ for _ in ()).throw(AssertionError('bad')) if DouyinAdapter().execute('comment', {}, approved=True).get('code') != 'ops-disabled' else None)
    platform_douyin.douyin_agent._call = _orig_call

    check('Douyin write deny', lambda: (_ for _ in ()).throw(AssertionError('bad')) if DouyinAdapter().execute('like', {}, approved=False).get('code') != 'approval-required' else None)
    check('unknown platform', lambda: (_ for _ in ()).throw(AssertionError('bad')) if v.dispatch('nope', 'repo', {}).get('code') != 'unknown-platform' else None)
    # B站写：无登录拒绝 + 有登录 fake 成功
    bw = platform_bilibili.BilibiliAdapter(fetch=bili_fetch, post=lambda path, data, sess: {'ok': True, 'data': {'code': 0}})
    check('B站写无登录拒绝', lambda: (_ for _ in ()).throw(AssertionError('bad')) if bw.execute('like', {'bvid': 'BV1xx411c7mD'}).get('code') != 'not-logged-in' else None)
    os.environ['BILI_SESSDATA'] = 's'; os.environ['BILI_CSRF'] = 'c'
    check('B站写 fake 成功', lambda: (_ for _ in ()).throw(AssertionError('bad')) if not bw.execute('like', {'bvid': 'BV1xx411c7mD'}).get('ok') else None)
    os.environ.pop('BILI_SESSDATA', None); os.environ.pop('BILI_CSRF', None)
    # P2 approval
    r2 = FakeAdapter(risk='R2')
    wb = platform_broker.PlatformBroker({'x': r2}, writes_enabled=False, owner='ougezi')
    check('P2 write disabled', lambda: (_ for _ in ()).throw(AssertionError('bad')) if wb.dispatch('x', 'x', {}).get('code') != 'write-disabled' else None)
    wb2 = platform_broker.PlatformBroker({'x': r2}, writes_enabled=True, owner='ougezi')
    req = wb2.request_write('x', 'x', {})
    check('P2 request pending', lambda: (_ for _ in ()).throw(AssertionError('bad')) if req.get('state') != 'pending' else None)
    check('P2 no approval deny', lambda: (_ for _ in ()).throw(AssertionError('bad')) if wb2.dispatch('x', 'x', {}).get('code') != 'approval-required' else None)
    check('P2 wrong approver', lambda: (_ for _ in ()).throw(AssertionError('bad')) if wb2.approve_write(req['id'], 'nope').get('code') != 'wrong-approver' else None)
    check('P2 approve', lambda: (_ for _ in ()).throw(AssertionError('bad')) if wb2.approve_write(req['id'], 'ougezi').get('state') != 'approved' else None)
    check('P2 approved execute', lambda: (_ for _ in ()).throw(AssertionError('bad')) if not wb2.dispatch('x', 'x', {}, approved=True, approval_id=req['id']).get('ok') else None)
    # P1 shadow / receipt
    fs = FakeAdapter(risk='R1')
    sh = Shadow()
    sb = platform_broker.PlatformBroker({'x': fs}, shadow=sh)
    sr = sb.dispatch('x', 'x', {})
    check('shadow no execute', lambda: (_ for _ in ()).throw(AssertionError('bad')) if fs.calls or not sr.get('shadow') else None)
    tmp = tempfile.mkdtemp(prefix='whale-p1-')
    rp = os.path.join(tmp, 'receipts.jsonl')
    rb2 = platform_broker.PlatformBroker({'x': fs}, receipt_path=rp)
    rr = rb2.dispatch('x', 'x', {}, action_id='a1')
    check('receipt written', lambda: (_ for _ in ()).throw(AssertionError('bad')) if not os.path.exists(rp) or not json.loads(open(rp, encoding='utf-8').readline()).get('actionId') == 'a1' else None)
    print('\n通过 %d/%d' % (PASS, PASS + FAIL))
    return 0 if FAIL == 0 else 1


if __name__ == '__main__':
    sys.exit(main())
