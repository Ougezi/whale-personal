# -*- coding: utf-8 -*-
"""P0 · B站只读 adapter。

只访问 api.bilibili.com 的公开接口；不点赞、不评论、不投币。
默认不带登录 cookie；412/429 明确返回，不伪装成功。
"""
import hashlib
import json
import re
import urllib.error
import urllib.parse
import urllib.request

API = 'https://api.bilibili.com'
UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36'
BV_RE = re.compile(r'^BV[0-9A-Za-z]{10}$')


class BilibiliError(Exception):
    pass


def _request(url, timeout=15):
    req = urllib.request.Request(url, headers={
        'User-Agent': UA,
        'Referer': 'https://www.bilibili.com/',
        'Accept': 'application/json,text/plain,*/*',
    })
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            raw = r.read().decode('utf-8', 'replace')
            return r.status, raw, ''
    except urllib.error.HTTPError as e:
        raw = ''
        try:
            raw = e.read().decode('utf-8', 'replace')
        except Exception:
            pass
        return e.code, raw, 'http-%s' % e.code
    except Exception as e:
        return 0, '', str(e)[:160]


def _json(raw):
    try:
        return json.loads(raw or '{}')
    except Exception:
        return {}


class BilibiliAdapter:
    platform = 'bilibili'

    def __init__(self, fetch=None):
        self.fetch = fetch or _request

    def available(self):
        return {'ok': True, 'api': API, 'login': False}

    def capabilities(self):
        return [
            {'op': 'view', 'risk': 'R1', 'args': ['bvid']},
            {'op': 'search', 'risk': 'R1', 'args': ['keyword', 'limit']},
            {'op': 'comments', 'risk': 'R1', 'args': ['bvid', 'limit']},
            {'op': 'user', 'risk': 'R1', 'args': ['mid']},
        ]

    def _get(self, path):
        status, raw, err = self.fetch(API + path)
        data = _json(raw)
        if status != 200:
            code = 'risk-control' if status == 412 else ('rate-limit' if status == 429 else 'http-%s' % status)
            return {'ok': False, 'code': code, 'text': 'B站请求失败（%s）' % code, 'evidence': {}}
        code = data.get('code', 0)
        if code not in (0, None):
            mapped = 'not-found' if code == -404 else ('risk-control' if code in (-412, -352) else 'api-%s' % code)
            return {'ok': False, 'code': mapped, 'text': 'B站接口返回 %s' % mapped, 'evidence': {}}
        return {'ok': True, 'data': data, 'raw': raw, 'source': API + path}

    def execute(self, op, args=None):
        args = args or {}
        if op == 'view':
            bvid = str(args.get('bvid') or '').strip()
            if not BV_RE.match(bvid):
                return {'ok': False, 'code': 'bad-bvid', 'text': 'BV 号格式不对', 'evidence': {}}
            got = self._get('/x/web-interface/view?bvid=' + urllib.parse.quote(bvid))
            if not got.get('ok'):
                return got
            d = got['data'].get('data') or {}
            text = '%s（UP：%s，播放：%s）%s' % (
                d.get('title'), (d.get('owner') or {}).get('name'), (d.get('stat') or {}).get('view'),
                (d.get('desc') or '')[:200])
        elif op == 'search':
            kw = str(args.get('keyword') or '').strip()
            if not kw:
                return {'ok': False, 'code': 'bad-query', 'text': '搜索词为空', 'evidence': {}}
            n = min(20, max(1, int(args.get('limit') or 5)))
            got = self._get('/x/web-interface/search/type?search_type=video&keyword=%s&page=1&page_size=%d' % (
                urllib.parse.quote(kw), n))
            if not got.get('ok'):
                return got
            items = ((got['data'].get('data') or {}).get('result') or [])[:n]
            text = '搜索 %d 条：' % len(items) + '；'.join(re.sub(r'<[^>]+>', '', str(i.get('title') or '')) for i in items[:5])
        elif op == 'comments':
            bvid = str(args.get('bvid') or '').strip()
            if not BV_RE.match(bvid):
                return {'ok': False, 'code': 'bad-bvid', 'text': 'BV 号格式不对', 'evidence': {}}
            v = self._get('/x/web-interface/view?bvid=' + urllib.parse.quote(bvid))
            if not v.get('ok'):
                return v
            aid = (v['data'].get('data') or {}).get('aid')
            n = min(20, max(1, int(args.get('limit') or 10)))
            got = self._get('/x/v2/reply?type=1&oid=%s&pn=1&ps=%d' % (urllib.parse.quote(str(aid)), n))
            if not got.get('ok'):
                return got
            replies = ((got['data'].get('data') or {}).get('replies') or [])[:n]
            text = '评论 %d 条：' % len(replies) + '；'.join(str(r.get('content', {}).get('message') or '')[:80] for r in replies[:5])
        elif op == 'user':
            mid = str(args.get('mid') or '').strip()
            if not mid.isdigit():
                return {'ok': False, 'code': 'bad-mid', 'text': 'mid 不对', 'evidence': {}}
            got = self._get('/x/web-interface/card?mid=' + urllib.parse.quote(mid))
            if not got.get('ok'):
                return got
            card = (got['data'].get('data') or {}).get('card') or {}
            text = '%s（粉丝：%s）' % (card.get('name'), (got['data'].get('data') or {}).get('fans'))
        else:
            return {'ok': False, 'code': 'unknown-op', 'text': '未知 B站操作', 'evidence': {}}
        raw = got.get('raw') or ''
        digest = hashlib.sha256(raw.encode('utf-8')).hexdigest()[:12]
        return {
            'ok': True,
            'data': got.get('data'),
            'text': text,
            'evidence': {
                'readback': 'bilibili:%s:%s:%s' % (op, len(raw), digest),
                'tests': ['http-200', 'api-code-0'],
                'source': got.get('source') or API,
            },
        }
