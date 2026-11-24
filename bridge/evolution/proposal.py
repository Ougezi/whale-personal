# -*- coding: utf-8 -*-
"""出生技能 · 进化提案校验（B4-01）。

提案不是“想法”，而是一个可审的包：
  hypothesis / targetLayer / diff / files / tests / expected / rollback / evidence / risk。

无证据、无测试、无回滚、diff 不可读、目标越界 —— 一律不进沙箱。
"""
import os
import re

SCHEMA_VERSION = 1
LAYERS = {'prompt', 'skill', 'parameter', 'memory-policy', 'persona'}
RISKS = {'R0', 'R1', 'R2', 'R3'}
STATUSES = {'draft', 'review', 'sandbox', 'promoted', 'rejected'}
FORBIDDEN = (
    'docs/personal/鲸鲸-出生技能-宪法.md',
    'bridge/brain_policy.py',
    'data/birth-skills/audit.jsonl',
)
FORBIDDEN_SEGMENTS = ('audit', 'permissions', 'kill-switch', 'rollback')


def _text(value):
    return str(value or '').strip()


def is_forbidden(path):
    p = _text(path).replace('\\', '/').lower()
    if any(p == f.lower() or p.endswith('/' + f.lower()) for f in FORBIDDEN):
        return True
    return any('/' + seg + '/' in '/' + p + '/' for seg in FORBIDDEN_SEGMENTS)


def parse_diff(diff):
    """最小 unified diff 读取：文件、hunk、增删行；不执行 patch。"""
    s = str(diff or '')
    if not s.strip():
        return {'ok': False, 'files': [], 'hunks': 0, 'additions': 0, 'deletions': 0, 'reason': 'empty'}
    if 'GIT binary patch' in s or 'Binary files' in s:
        return {'ok': False, 'files': [], 'hunks': 0, 'additions': 0, 'deletions': 0, 'reason': 'binary'}
    files = []
    for m in re.finditer(r'^\+\+\+\s+(?:b/)?(.+)$', s, re.M):
        f = m.group(1).strip()
        if f and f != '/dev/null' and f not in files:
            files.append(f)
    hunks = len(re.findall(r'^@@\s+-\d+(?:,\d+)?\s+\+\d+(?:,\d+)?\s+@@', s, re.M))
    adds = len(re.findall(r'^\+(?!\+\+)[^\n]*$', s, re.M))
    dels = len(re.findall(r'^-(?!--)[^\n]*$', s, re.M))
    if not files:
        return {'ok': False, 'files': [], 'hunks': hunks, 'additions': adds, 'deletions': dels, 'reason': 'no-files'}
    if hunks == 0:
        return {'ok': False, 'files': files, 'hunks': 0, 'additions': adds, 'deletions': dels, 'reason': 'no-hunks'}
    return {'ok': True, 'files': files, 'hunks': hunks, 'additions': adds, 'deletions': dels, 'reason': 'ok'}


def validate(proposal):
    errs = []
    if not isinstance(proposal, dict):
        return ['root must be object']
    for k in ('schemaVersion', 'id', 'status', 'hypothesis', 'targetLayer', 'diff', 'files', 'tests',
              'expected', 'rollback', 'evidence', 'risk', 'createdAt'):
        if k not in proposal:
            errs.append('missing ' + k)
    if proposal.get('schemaVersion') != SCHEMA_VERSION:
        errs.append('schemaVersion must be 1')
    if not re.match(r'^EVO-[0-9]{4,}$', _text(proposal.get('id'))):
        errs.append('id invalid')
    if proposal.get('status') not in STATUSES:
        errs.append('status invalid')
    if proposal.get('targetLayer') not in LAYERS:
        errs.append('targetLayer invalid')
    if proposal.get('risk') not in RISKS:
        errs.append('risk invalid')
    if len(_text(proposal.get('hypothesis'))) < 10:
        errs.append('hypothesis too short')
    if len(_text(proposal.get('expected'))) < 5:
        errs.append('expected required')
    if len(_text(proposal.get('rollback'))) < 5:
        errs.append('rollback required')
    files = proposal.get('files')
    if not isinstance(files, list) or not files:
        errs.append('files required')
        files = []
    if len(files) > 20:
        errs.append('files > 20')
    for f in files:
        if is_forbidden(f):
            errs.append('forbidden target: ' + str(f))
    tests = proposal.get('tests')
    if not isinstance(tests, list) or not tests:
        errs.append('tests required')
    evidence = proposal.get('evidence')
    if not isinstance(evidence, list) or not evidence:
        errs.append('evidence required')
    parsed = parse_diff(proposal.get('diff'))
    if not parsed['ok']:
        errs.append('diff unreadable: ' + parsed['reason'])
    if parsed['files'] and files:
        allowed = {os.path.normpath(str(f)).replace('\\', '/').lower() for f in files}
        for f in parsed['files']:
            if os.path.normpath(f).replace('\\', '/').lower() not in allowed:
                errs.append('diff file not declared: ' + f)
    return errs


def diff_summary(diff):
    p = parse_diff(diff)
    return {k: p[k] for k in ('ok', 'files', 'hunks', 'additions', 'deletions', 'reason')}


def sandbox_ready(proposal):
    """无证据/测试/回滚/可读 diff 的提案不能进沙箱。"""
    if validate(proposal):
        return False
    if proposal.get('status') not in ('review', 'sandbox'):
        return False
    if not proposal.get('evidence') or not proposal.get('tests') or not proposal.get('rollback'):
        return False
    return parse_diff(proposal.get('diff'))['ok']
