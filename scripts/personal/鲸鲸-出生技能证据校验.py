# -*- coding: utf-8 -*-
"""出生技能证据/审计/回滚校验器。

用法：
  python scripts/personal/鲸鲸-出生技能证据校验.py --check
  python scripts/personal/鲸鲸-出生技能证据校验.py --check <evidence.json>
  python scripts/personal/鲸鲸-出生技能证据校验.py --tamper-test
  python scripts/personal/鲸鲸-出生技能证据校验.py --audit-check data/birth-skills/audit.jsonl

门禁：
  - 每步 >=5 案例，ID 必须存在
  - 计划要求源码时，source_reviews 不能空
  - tests.fail == 0, pass >= 1
  - acceptance 全 ok
  - rollback 非空
  - audit 每条字段齐全、无密钥
"""
import json
import os
import re
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SCHEMA = os.path.join(ROOT, 'docs', 'personal', '鲸鲸-出生技能-证据.schema.json')
EXAMPLE = os.path.join(ROOT, 'docs', 'personal', '鲸鲸-出生技能-证据.example.json')
PLAN = os.path.join(ROOT, 'docs', 'personal', '鲸鲸-出生技能-执行计划.json')
CASES = os.path.join(ROOT, 'docs', 'personal', '鲸鲸-出生技能-案例库-313.json')
AUDIT = os.path.join(ROOT, 'data', 'birth-skills', 'audit.jsonl')

SECRET_RE = re.compile('sk' + '-' + r'[A-Za-z0-9]{8,}|DEEPSEEK_API_KEY\s*[=:]\s*\S+|Bearer\s+[A-Za-z0-9._-]{12,}|api[_-]?key\s*[=:]\s*[^\s,}"]{6,}', re.I)


def load(p):
    return json.load(open(p, encoding='utf-8'))


def secret_scan(obj):
    s = json.dumps(obj, ensure_ascii=False)
    m = SECRET_RE.search(s)
    return m.group(0)[:24] if m else ''


def audit_ok(events):
    errs = []
    if not isinstance(events, list) or not events:
        return ['audit must be non-empty array']
    for i, e in enumerate(events):
        if not isinstance(e, dict):
            errs.append('audit[%d] not object' % i); continue
        for k in ('at', 'step', 'action', 'actor', 'risk', 'evidence'):
            if k not in e:
                errs.append('audit[%d] missing %s' % (i, k))
        if not isinstance(e.get('at'), int) or e.get('at', 0) < 0:
            errs.append('audit[%d].at invalid' % i)
        if e.get('risk') not in ('R0', 'R1', 'R2', 'R3'):
            errs.append('audit[%d].risk invalid' % i)
        if not str(e.get('evidence') or '').strip():
            errs.append('audit[%d].evidence empty' % i)
    return errs


def validate(ev, plan=None, corpus=None):
    errs = []
    for k in ('version', 'step', 'status', 'case_ids', 'source_reviews', 'changes',
              'tests', 'acceptance', 'rollback', 'audit', 'finishedAt'):
        if k not in ev:
            errs.append('missing ' + k)
    if ev.get('version') != 1:
        errs.append('version must be 1')
    if ev.get('status') != 'done':
        errs.append('status must be done')
    ids = ev.get('case_ids') or []
    if not isinstance(ids, list) or len(ids) < 5:
        errs.append('case_ids < 5')
    if not isinstance(ids, list) or len(set(ids)) != len(ids):
        errs.append('case_ids duplicate')
    if corpus:
        known = set(corpus)
        miss = [x for x in ids if x not in known]
        if miss:
            errs.append('case_ids not in corpus: ' + ','.join(miss[:5]))
    step = ev.get('step')
    if plan:
        p = next((x for x in plan.get('steps', []) if x['id'] == step), None)
        if p and p.get('source_review') and not ev.get('source_reviews'):
            errs.append('source_reviews required for ' + step)
        if p:
            req = int(p.get('min_cases') or 5)
            if len(ids) < req:
                errs.append('case_ids < step min %d' % req)
    if not isinstance(ev.get('changes'), list) or not ev.get('changes'):
        errs.append('changes required')
    t = ev.get('tests') or {}
    if not isinstance(t.get('pass'), int) or t.get('pass', 0) < 1:
        errs.append('tests.pass >= 1 required')
    if t.get('fail') != 0:
        errs.append('tests.fail must be 0')
    if not isinstance(t.get('commands'), list) or not t.get('commands'):
        errs.append('tests.commands required')
    acc = ev.get('acceptance')
    if not isinstance(acc, list) or not acc:
        errs.append('acceptance required')
    else:
        for i, a in enumerate(acc):
            if not isinstance(a, dict) or a.get('ok') is not True:
                errs.append('acceptance[%d] not ok' % i)
            if not str(a.get('item') or '').strip() or not str(a.get('evidence') or '').strip():
                errs.append('acceptance[%d] incomplete' % i)
    if not str(ev.get('rollback') or '').strip():
        errs.append('rollback required')
    errs += audit_ok(ev.get('audit'))
    s = secret_scan(ev)
    if s:
        errs.append('secret leaked: ' + s)
    return errs


def cmd_check(path=EXAMPLE):
    try:
        schema = load(SCHEMA)
        if not schema.get('$schema') or not schema.get('required'):
            raise ValueError('schema missing $schema/required')
        plan = load(PLAN)
        corpus = load(CASES)
        ev = load(path)
    except Exception as e:
        print('✗ 读取失败：' + repr(e)); return 1
    errs = validate(ev, plan, [x['id'] for x in corpus['items']])
    if errs:
        print('✗ 证据不合法：')
        for e in errs: print('  - ' + e)
        return 1
    print('✓ 证据 schema 通过')
    print('✓ 案例门禁 %d 条，ID 存在' % len(ev['case_ids']))
    print('✓ 测试 pass=%d fail=0' % ev['tests']['pass'])
    print('✓ acceptance 全过')
    print('✓ rollback 非空')
    print('✓ audit %d 条字段齐全、无密钥' % len(ev['audit']))
    return 0


def cmd_tamper():
    base = load(EXAMPLE)
    cases = []
    x = json.loads(json.dumps(base)); x['case_ids'] = []; cases.append(('missing cases', x))
    x = json.loads(json.dumps(base)); x['rollback'] = ''; cases.append(('empty rollback', x))
    x = json.loads(json.dumps(base)); x['audit'] = []; cases.append(('empty audit', x))
    x = json.loads(json.dumps(base)); x['rollback'] = 'sk' + '-' + 'ABCD' + 'EFGH' + '12345678'; cases.append(('secret leak', x))
    x = json.loads(json.dumps(base)); x['acceptance'][0]['ok'] = False; cases.append(('failed acceptance', x))
    bad = []
    for name, doc in cases:
        errs = validate(doc, load(PLAN), [x['id'] for x in load(CASES)['items']])
        if not errs:
            bad.append(name)
        else:
            print('  ✓ 拒绝 %-18s %s' % (name, errs[0][:70]))
    if bad:
        print('✗ 未拒绝：' + ','.join(bad)); return 1
    print('✓ 5/5 非法证据被拒绝')
    return 0


def cmd_audit_check(path=AUDIT):
    if not os.path.isfile(path):
        print('✗ 审计不存在：' + path); return 1
    rows = []
    for line in open(path, encoding='utf-8'):
        line = line.strip()
        if line:
            try: rows.append(json.loads(line))
            except Exception as e:
                print('✗ 审计行不是 JSON：' + repr(e)); return 1
    errs = audit_ok(rows)
    s = secret_scan(rows)
    if s: errs.append('audit secret leaked: ' + s)
    if errs:
        print('✗ 审计不合法：'); [print('  - ' + e) for e in errs]; return 1
    print('✓ 审计 %d 条全部字段齐全' % len(rows))
    print('✓ 审计无密钥')
    return 0


def main():
    if '--tamper-test' in sys.argv: return cmd_tamper()
    if '--audit-check' in sys.argv:
        i = sys.argv.index('--audit-check')
        path = sys.argv[i + 1] if i + 1 < len(sys.argv) else AUDIT
        return cmd_audit_check(path)
    path = EXAMPLE
    if '--check' in sys.argv:
        i = sys.argv.index('--check')
        if i + 1 < len(sys.argv) and not sys.argv[i + 1].startswith('--'):
            path = sys.argv[i + 1]
    return cmd_check(path)


if __name__ == '__main__':
    sys.exit(main())
