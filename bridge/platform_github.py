# -*- coding: utf-8 -*-
"""P0 · GitHub 只读 adapter。

只访问 api.github.com；不 push、不评论、不改仓库。
token 只从环境变量 GITHUB_TOKEN 读取，不写日志/证据/回复。
"""
import base64
import hashlib
import json
import os
import re
import urllib.error
import urllib.parse
import urllib.request

API = 'https://api.github.com'
UA = 'whale-personal-platform/1.0'
REPO_RE = re.compile(r'^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$')


class GitHubError(Exception):
    pass


def _token():
    return (os.environ.get('GITHUB_TOKEN') or '').strip()


def _request(url, token=None, timeout=15):
    headers = {'User-Agent': UA, 'Accept': 'application/vnd.github+json'}
    if token:
        headers['Authorization'] = 'Bearer ' + token
    req = urllib.request.Request(url, headers=headers)
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


class GitHubAdapter:
    platform = 'github'

    def __init__(self, fetch=None):
        self.fetch = fetch or (lambda url: _request(url, _token()))

    def available(self):
        return {'ok': True, 'token': bool(_token()), 'api': API}

    def capabilities(self):
        return [
            {'op': 'repo', 'risk': 'R1', 'args': ['repo']},
            {'op': 'readme', 'risk': 'R1', 'args': ['repo']},
            {'op': 'issues', 'risk': 'R1', 'args': ['repo', 'state', 'limit']},
            {'op': 'issue', 'risk': 'R1', 'args': ['repo', 'number']},
            {'op': 'pulls', 'risk': 'R1', 'args': ['repo', 'state', 'limit']},
            {'op': 'pull', 'risk': 'R1', 'args': ['repo', 'number']},
            {'op': 'actions', 'risk': 'R1', 'args': ['repo', 'limit']},
            {'op': 'release', 'risk': 'R1', 'args': ['repo', 'tag']},
        ]

    def _repo(self, args):
        repo = str((args or {}).get('repo') or '').strip()
        if not REPO_RE.match(repo):
            raise GitHubError('repo must be owner/name')
        return repo

    def execute(self, op, args=None):
        args = args or {}
        repo = self._repo(args)
        url = ''
        if op == 'repo':
            url = API + '/repos/' + repo
        elif op == 'readme':
            url = API + '/repos/' + repo + '/readme'
        elif op == 'issues':
            url = API + '/repos/%s/issues?state=%s&per_page=%d' % (
                repo, urllib.parse.quote(str(args.get('state') or 'open')), min(20, max(1, int(args.get('limit') or 5))))
        elif op == 'issue':
            url = API + '/repos/%s/issues/%d' % (repo, int(args.get('number') or 0))
        elif op == 'pulls':
            url = API + '/repos/%s/pulls?state=%s&per_page=%d' % (
                repo, urllib.parse.quote(str(args.get('state') or 'open')), min(20, max(1, int(args.get('limit') or 5))))
        elif op == 'pull':
            url = API + '/repos/%s/pulls/%d' % (repo, int(args.get('number') or 0))
        elif op == 'actions':
            url = API + '/repos/%s/actions/runs?per_page=%d' % (repo, min(10, max(1, int(args.get('limit') or 3))))
        elif op == 'release':
            tag = str(args.get('tag') or '').strip()
            url = API + '/repos/%s/releases/%s' % (repo, urllib.parse.quote(tag) if tag else 'latest')
        else:
            raise GitHubError('unknown op: ' + str(op))
        status, raw, err = self.fetch(url)
        if status != 200:
            code = 'rate-limit' if status == 403 else ('not-found' if status == 404 else ('bad-token' if status == 401 else 'http-%s' % status))
            return {'ok': False, 'code': code, 'text': 'GitHub %s 失败（%s）' % (op, code), 'evidence': {}}
        data = _json(raw)
        text = self._text(op, data)
        digest = hashlib.sha256(raw.encode('utf-8')).hexdigest()[:12]
        return {
            'ok': True,
            'data': data,
            'text': text,
            'evidence': {
                'readback': 'github:%s:%s:%s:%s' % (op, status, len(raw), digest),
                'tests': ['http-200', 'json'],
                'source': url,
            },
        }

    def _text(self, op, data):
        if op == 'repo':
            return '%s：stars=%s，language=%s，%s' % (
                data.get('full_name'), data.get('stargazers_count'), data.get('language'), (data.get('description') or '')[:160])
        if op == 'readme':
            try:
                content = base64.b64decode(data.get('content') or '').decode('utf-8', 'replace')
            except Exception:
                content = ''
            return 'README（%s）：%s' % (data.get('name') or '', content[:1200].replace('\r', ''))
        if op == 'issues':
            items = data if isinstance(data, list) else []
            return 'issue %d 条：' % len(items) + '；'.join('#%s %s' % (i.get('number'), i.get('title')) for i in items[:5])
        if op == 'issue':
            return '#%s %s（%s）' % (data.get('number'), data.get('title'), data.get('state'))
        if op == 'pulls':
            items = data if isinstance(data, list) else []
            return 'PR %d 条：' % len(items) + '；'.join('#%s %s' % (i.get('number'), i.get('title')) for i in items[:5])
        if op == 'pull':
            return '#%s %s（%s）' % (data.get('number'), data.get('title'), data.get('state'))
        if op == 'actions':
            runs = (data.get('workflow_runs') or []) if isinstance(data, dict) else []
            return 'Actions %d 个：' % len(runs) + '；'.join('%s:%s' % (r.get('name'), r.get('conclusion')) for r in runs[:3])
        if op == 'release':
            return 'release %s：%s' % (data.get('tag_name'), (data.get('name') or '')[:120])
        return 'GitHub 结果'
