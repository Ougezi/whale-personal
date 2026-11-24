# -*- coding: utf-8 -*-
"""鲸鲸主链接入状态检查。

用法：
  python skills/whale-mainline-integration/scripts/integration_check.py --check
  python skills/whale-mainline-integration/scripts/integration_check.py --json
"""
import argparse
import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
PLAN = ROOT / 'docs' / 'personal' / '鲸鲸-主链接入-执行计划.json'
STATE = ROOT / 'data' / 'integration' / 'state.json'
EVID = ROOT / 'data' / 'integration' / 'evidence'
# 启动器更新可能把 data 移到仓库外；只读检查自动回退，不改数据
if not STATE.exists():
    _backup = ROOT.parent / '_local-data-backup' / 'integration'
    if (_backup / 'state.json').exists():
        STATE = _backup / 'state.json'
        EVID = _backup / 'evidence'
CASES = ROOT / 'docs' / 'personal' / '鲸鲸-出生技能-案例库-313.json'


def load(p, fallback=None):
    try:
        with open(p, encoding='utf-8') as f:
            return json.load(f)
    except Exception:
        return fallback


def check():
    plan = load(PLAN)
    state = load(STATE, {})
    cases = load(CASES, {})
    known = {x['id'] for x in (cases.get('items') or [])}
    if not plan:
        return {'ok': False, 'errors': ['missing integration plan'], 'steps': []}
    rows = []
    errors = []
    done = blocked = 0
    for step in plan.get('steps', []):
        sid = step['id']
        st = (state.get('steps') or {}).get(sid) or {}
        status = st.get('status', 'pending')
        evp = EVID / (sid + '.json')
        ev = load(evp)
        row = {'id': sid, 'title': step.get('title', ''), 'status': status,
               'evidence': (str(evp.relative_to(ROOT)) if evp.exists() and evp.is_relative_to(ROOT) else str(evp)) if evp.exists() else '',
               'tests': (ev or {}).get('tests', {}), 'errors': []}
        if status == 'done':
            done += 1
            if not ev:
                row['errors'].append('missing evidence')
            else:
                ids = ev.get('case_ids') or []
                if len(ids) < int(step.get('min_cases') or 5):
                    row['errors'].append('case_ids < min_cases')
                if known and any(x not in known for x in ids):
                    row['errors'].append('case_ids not in 313 library')
                if int((ev.get('tests') or {}).get('fail', 0)) != 0:
                    row['errors'].append('tests.fail != 0')
                if not ev.get('rollback'):
                    row['errors'].append('rollback missing')
                for a in ev.get('acceptance') or []:
                    if a.get('ok') is not True:
                        row['errors'].append('acceptance not ok: ' + str(a.get('item')))
        elif status == 'blocked':
            blocked += 1
            if not ev:
                row['errors'].append('blocked without evidence')
        elif status != 'pending':
            row['errors'].append('unknown status ' + status)
        rows.append(row)
        errors.extend(f"{sid}: {e}" for e in row['errors'])
    all_done = done == len(plan.get('steps', []))
    if state.get('current') and not all_done:
        cur = state['current']
        if cur not in [r['id'] for r in rows if r['status'] in ('pending', 'blocked')]:
            errors.append('state.current is not a pending/blocked step: ' + cur)
    return {'ok': all_done and not errors, 'complete': all_done, 'done': done,
            'blocked': blocked, 'total': len(plan.get('steps', [])),
            'current': state.get('current', ''), 'errors': errors, 'steps': rows}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--check', action='store_true')
    ap.add_argument('--json', action='store_true')
    a = ap.parse_args()
    r = check()
    if a.json:
        print(json.dumps(r, ensure_ascii=False, indent=1))
    else:
        print('主链接入：%d/%d done，%d blocked，current=%s' % (r['done'], r['total'], r['blocked'], r['current']))
        for s in r['steps']:
            print('  %-5s %-10s %s' % (s['id'], s['status'], '; '.join(s['errors']) if s['errors'] else 'ok'))
        if r['errors']:
            print('错误：')
            for e in r['errors']:
                print('  - ' + e)
    return 0 if (r['ok'] or not a.check) else 1


if __name__ == '__main__':
    sys.exit(main())
