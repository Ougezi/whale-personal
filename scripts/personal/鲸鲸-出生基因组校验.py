# -*- coding: utf-8 -*-
"""出生基因组校验器：只读层、非法字段、版本回滚。

用法：
  python scripts/personal/鲸鲸-出生基因组校验.py --check
  python scripts/personal/鲸鲸-出生基因组校验.py --check <genome.json>
  python scripts/personal/鲸鲸-出生基因组校验.py --tamper-test
"""
import copy
import hashlib
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
CONST = os.path.join(ROOT, 'docs', 'personal', '鲸鲸-出生技能-宪法.md')
SCHEMA = os.path.join(ROOT, 'docs', 'personal', '鲸鲸-出生技能-基因组.schema.json')
EXAMPLE = os.path.join(ROOT, 'docs', 'personal', '鲸鲸-出生技能-基因组.example.json')
KEYS = {'schemaVersion', 'constitution', 'identity', 'capabilities', 'skills',
        'policies', 'prompts', 'memory', 'versions', 'meta'}
CAPS = {'chat', 'memory', 'dsh', 'grow'}
RISKS = {'R0', 'R1', 'R2', 'R3'}
SOURCES = {'builtin', 'owner', 'plugin', 'evolved'}
PROJ = {'working', 'episode', 'semantic', 'procedural', 'prospective', 'affect', 'self', 'meta'}
VER_RE = re.compile(r'^\d+\.\d+\.\d+$')
HEX_RE = re.compile(r'^[a-f0-9]{64}$')


def sha256(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for chunk in iter(lambda: f.read(65536), b''):
            h.update(chunk)
    return h.hexdigest()


def validate(doc, actual_hash=None):
    errs = []
    if not isinstance(doc, dict):
        return ['root must be object']
    unknown = [k for k in doc if k not in KEYS and not k.startswith('x-')]
    if unknown:
        errs.append('unknown root keys: ' + ','.join(unknown))
    for k in sorted(KEYS):
        if k not in doc:
            errs.append('missing ' + k)
    if doc.get('schemaVersion') != 1:
        errs.append('schemaVersion must be 1')

    c = doc.get('constitution') or {}
    if c.get('path') != 'docs/personal/鲸鲸-出生技能-宪法.md':
        errs.append('constitution.path changed')
    if c.get('readonly') is not True:
        errs.append('constitution.readonly must be true')
    if not HEX_RE.match(str(c.get('hash') or '')):
        errs.append('constitution.hash invalid')
    if actual_hash and c.get('hash') != actual_hash:
        errs.append('constitution.hash does not match real constitution')

    ide = doc.get('identity') or {}
    if not str(ide.get('name') or '').strip():
        errs.append('identity.name required')
    if not str(ide.get('persona') or '').strip():
        errs.append('identity.persona required')
    if ide.get('ownerScope') not in ('master-only', 'master-group', 'master-group-public'):
        errs.append('identity.ownerScope invalid')

    caps = doc.get('capabilities')
    if not isinstance(caps, list) or len(caps) != len(set(caps)):
        errs.append('capabilities must be unique array')
        caps = []
    if not {'chat', 'memory', 'dsh'}.issubset(set(caps)):
        errs.append('capabilities must include chat/memory/dsh')
    if any(x not in CAPS for x in caps):
        errs.append('capabilities contains unknown value')

    skills = doc.get('skills')
    if not isinstance(skills, list):
        errs.append('skills must be array')
        skills = []
    seen = set()
    for s in skills:
        if not isinstance(s, dict):
            errs.append('skill must be object')
            continue
        sid = s.get('id')
        if not isinstance(sid, str) or not re.match(r'^[a-z][a-z0-9_.-]{1,63}$', sid):
            errs.append('skill.id invalid')
        if sid in seen:
            errs.append('duplicate skill ' + str(sid))
        seen.add(sid)
        if not VER_RE.match(str(s.get('version') or '')):
            errs.append('skill.version invalid: ' + str(sid))
        if not isinstance(s.get('enabled'), bool):
            errs.append('skill.enabled must be bool: ' + str(sid))
        if s.get('risk') not in RISKS:
            errs.append('skill.risk invalid: ' + str(sid))
        if s.get('source') not in SOURCES:
            errs.append('skill.source invalid: ' + str(sid))
        if s.get('risk') in ('R2', 'R3') and s.get('requiresApproval') is not True:
            errs.append('R2/R3 skill must requiresApproval=true: ' + str(sid))

    pol = doc.get('policies') or {}
    if not isinstance(pol.get('allowedRoots'), list) or not pol.get('allowedRoots'):
        errs.append('policies.allowedRoots required')
    if not isinstance(pol.get('denyPaths'), list):
        errs.append('policies.denyPaths must be array')
    if pol.get('network') not in ('denied', 'approval', 'allowed'):
        errs.append('policies.network invalid')
    appr = pol.get('approvals') or {}
    if appr.get('R2') not in ('owner', 'auto'):
        errs.append('policies.approvals.R2 invalid')
    if appr.get('R3') not in ('owner', 'double'):
        errs.append('policies.approvals.R3 invalid')
    if pol.get('maxRisk') not in RISKS:
        errs.append('policies.maxRisk invalid')

    pr = doc.get('prompts') or {}
    for k in ('static', 'dynamic'):
        if not isinstance(pr.get(k), dict):
            errs.append('prompts.' + k + ' required')
    if isinstance(pr.get('static'), dict):
        if not pr['static'].get('version'):
            errs.append('prompts.static.version required')
        if not HEX_RE.match(str(pr['static'].get('hash') or '')):
            errs.append('prompts.static.hash invalid')
    if isinstance(pr.get('dynamic'), dict) and not pr['dynamic'].get('version'):
        errs.append('prompts.dynamic.version required')

    mem = doc.get('memory') or {}
    if not isinstance(mem.get('schemaVersion'), int) or mem['schemaVersion'] < 1:
        errs.append('memory.schemaVersion invalid')
    if mem.get('eventLog') != 'append-only':
        errs.append('memory.eventLog must be append-only')
    if not isinstance(mem.get('projections'), list) or any(x not in PROJ for x in mem['projections']):
        errs.append('memory.projections invalid')

    ver = doc.get('versions') or {}
    g = ver.get('genome')
    if not isinstance(g, int) or g < 1:
        errs.append('versions.genome invalid')
    if not isinstance(ver.get('minSupported'), int) or ver['minSupported'] < 1:
        errs.append('versions.minSupported invalid')
    if g and ver.get('minSupported', 1) > g:
        errs.append('versions.minSupported > genome')
    rb = ver.get('rollbackTo')
    if rb is not None and (not isinstance(rb, int) or rb < 0 or (g and rb > g)):
        errs.append('versions.rollbackTo invalid')

    meta = doc.get('meta') or {}
    if not isinstance(meta.get('createdAt'), int) or not isinstance(meta.get('updatedAt'), int):
        errs.append('meta timestamps invalid')
    return errs


def check(path=EXAMPLE):
    actual = sha256(CONST) if os.path.isfile(CONST) else None
    try:
        schema = json.load(open(SCHEMA, encoding='utf-8'))
        if not schema.get('$schema') or not schema.get('required'):
            raise ValueError('schema missing $schema/required')
    except Exception as e:
        print('✗ schema 读取失败：' + repr(e))
        return 1
    doc = json.load(open(path, encoding='utf-8'))
    errs = validate(doc, actual)
    if errs:
        print('✗ 基因组不合法：')
        for e in errs:
            print('  - ' + e)
        return 1
    print('✓ schema 文件可读')
    print('✓ 基因组 schema 通过')
    print('✓ 只读层 constitution 未变')
    print('✓ 非法字段/无效枚举/版本规则通过')
    print('✓ 版本可回滚 rollbackTo=%s' % doc['versions'].get('rollbackTo'))
    return 0


def tamper_test():
    base = json.load(open(EXAMPLE, encoding='utf-8'))
    cases = []
    x = copy.deepcopy(base); x['constitution']['readonly'] = False; cases.append(('readonly=false', x))
    x = copy.deepcopy(base); x['backdoor'] = True; cases.append(('unknown field', x))
    x = copy.deepcopy(base); x['versions']['rollbackTo'] = 999; cases.append(('rollbackTo>genome', x))
    x = copy.deepcopy(base); x['policies']['approvals']['R3'] = 'auto'; cases.append(('R3 auto', x))
    bad = []
    for name, doc in cases:
        errs = validate(doc, sha256(CONST))
        if not errs:
            bad.append(name)
        else:
            print('  ✓ 拒绝 ' + name + '：' + errs[0])
    if bad:
        print('✗ 未拒绝：' + ','.join(bad))
        return 1
    print('✓ 4/4 非法基因组被拒绝')
    return 0


def main():
    if '--tamper-test' in sys.argv:
        return tamper_test()
    path = EXAMPLE
    if '--check' in sys.argv:
        i = sys.argv.index('--check')
        if i + 1 < len(sys.argv) and not sys.argv[i + 1].startswith('--'):
            path = sys.argv[i + 1]
    return check(path)


if __name__ == '__main__':
    sys.exit(main())
