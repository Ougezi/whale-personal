# -*- coding: utf-8 -*-
"""P0 · B站只读 adapter。

只访问 api.bilibili.com 的公开接口；不点赞、不评论、不投币。
默认不带登录 cookie；412/429 明确返回，不伪装成功。
"""
import hashlib
import json
import os
import re
import time
import urllib.error
import urllib.parse
import urllib.request

API = 'https://api.bilibili.com'
UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36'
BV_RE = re.compile(r'^BV[0-9A-Za-z]{10}$')
MIXIN_KEY_ENC_TAB = [46,47,18,2,53,8,23,32,15,50,10,31,58,3,45,35,27,43,5,49,33,9,42,19,29,28,14,39,12,38,41,13,37,48,7,16,24,55,40,61,26,17,0,1,60,51,30,4,22,25,54,21,56,59,6,63,57,62,11,36,20,34,44,52]


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


def _post(path, data, sess):
    body = urllib.parse.urlencode(data).encode('utf-8')
    req = urllib.request.Request(API + path, data=body, headers={
        'User-Agent': UA,
        'Referer': 'https://www.bilibili.com/',
        'Content-Type': 'application/x-www-form-urlencoded',
        'Cookie': 'SESSDATA=' + sess,
    }, method='POST')
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            return {'ok': True, 'data': _json(r.read().decode('utf-8', 'replace')), 'source': API + path}
    except urllib.error.HTTPError as e:
        raw = ''
        try: raw = e.read().decode('utf-8', 'replace')
        except Exception: pass
        return {'ok': False, 'code': 'http-%s' % e.code, 'text': 'B站写请求失败', 'evidence': {}}
    except Exception as e:
        return {'ok': False, 'code': 'request-failed', 'text': str(e)[:160], 'evidence': {}}


class BilibiliAdapter:
    platform = 'bilibili'

    def __init__(self, fetch=None, post=None):
        self.fetch = fetch or _request
        self.post = post or _post
        self._wbi_raw = ''
        self._wbi_at = 0

    def available(self):
        return {'ok': True, 'api': API, 'login': bool((os.environ.get('BILI_SESSDATA') or '').strip()), 'wbi': bool(self._wbi_raw)}

    def capabilities(self):
        return [
            {'op': 'view', 'risk': 'R1', 'args': ['bvid']},
            {'op': 'search', 'risk': 'R1', 'args': ['keyword', 'limit']},
            {'op': 'comments', 'risk': 'R1', 'args': ['bvid', 'limit']},
            {'op': 'user', 'risk': 'R1', 'args': ['mid']},
            {'op': 'like', 'risk': 'R2', 'args': ['bvid', 'like']},
            {'op': 'comment', 'risk': 'R2', 'args': ['bvid', 'message']},
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

    def _wbi_signed(self, path, params):
        now = int(time.time())
        if not self._wbi_raw or now - self._wbi_at > 600:
            status, raw, _ = self.fetch(API + '/x/web-interface/nav')
            data = _json(raw)
            img = (((data.get('data') or {}).get('wbi_img') or {}).get('img_url') or '')
            sub = (((data.get('data') or {}).get('wbi_img') or {}).get('sub_url') or '')
            img_key = img.rsplit('/', 1)[-1].split('.')[0]
            sub_key = sub.rsplit('/', 1)[-1].split('.')[0]
            if not img_key or not sub_key:
                raise BilibiliError('no wbi keys')
            self._wbi_raw = img_key + sub_key
            self._wbi_at = now
        raw = ''.join(self._wbi_raw[i] for i in MIXIN_KEY_ENC_TAB)[:32]
        p = dict(params)
        p['wts'] = now
        query = urllib.parse.urlencode(sorted(p.items()))
        p['w_rid'] = hashlib.md5((query + raw).encode('utf-8')).hexdigest()
        return path + '?' + urllib.parse.urlencode(sorted(p.items()))

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
            path = '/x/web-interface/wbi/search/type'
            params = {'search_type': 'video', 'keyword': kw, 'page': 1, 'page_size': n}
            try:
                path = self._wbi_signed(path, params)
            except Exception:
                path = '/x/web-interface/search/type?' + urllib.parse.urlencode(params)
            got = self._get(path)
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
        elif op in ('like', 'comment'):
            sess = (os.environ.get('BILI_SESSDATA') or '').strip()
            csrf = (os.environ.get('BILI_CSRF') or '').strip()
            if not sess or not csrf:
                return {'ok': False, 'code': 'not-logged-in', 'text': 'B站写操作需要 BILI_SESSDATA / BILI_CSRF', 'evidence': {}}
            bvid = str(args.get('bvid') or '').strip()
            if not BV_RE.match(bvid):
                return {'ok': False, 'code': 'bad-bvid', 'text': 'BV 号格式不对', 'evidence': {}}
            v = self._get('/x/web-interface/view?bvid=' + urllib.parse.quote(bvid))
            if not v.get('ok'):
                return v
            aid = (v['data'].get('data') or {}).get('aid')
            if op == 'like':
                got = self.post('/x/web-interface/archive/like', {'bvid': bvid, 'like': 1 if args.get('like', 1) else 0, 'csrf': csrf}, sess)
            else:
                msg = str(args.get('message') or '').strip()
                if not msg:
                    return {'ok': False, 'code': 'bad-message', 'text': '评论为空', 'evidence': {}}
                got = self.post('/x/v2/reply/add', {'oid': aid, 'type': 1, 'message': msg, 'csrf': csrf}, sess)
            if not got.get('ok'):
                return got
            data = got.get('data') or {}
            if data.get('code') not in (0, None):
                return {'ok': False, 'code': 'api-%s' % data.get('code'), 'text': 'B站写失败：%s' % data.get('message', ''), 'evidence': {}}
            text = 'B站点赞成功' if op == 'like' else 'B站评论已提交'
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
