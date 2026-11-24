# -*- coding: utf-8 -*-
"""读取主链接入计划，给出下一步/阻塞项；只读。"""
import argparse
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
PLAN = os.path.join(ROOT, 'docs', 'personal', '鲸鲸-主链接入-执行计划.json')
STATE = os.path.join(ROOT, 'data', 'integration', 'state.json')
if not os.path.exists(STATE):
    _b = os.path.join(os.path.dirname(ROOT), '_local-data-backup', 'integration', 'state.json')
    if os.path.exists(_b):
        STATE = _b
CASES = os.path.join(ROOT, 'docs', 'personal', '鲸鲸-出生技能-案例库-313.json')


def load(path, fallback):
    try:
        with open(path, encoding='utf-8') as f:
            return json.load(f)
    except Exception:
        return fallback


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--json', action='store_true')
    a = ap.parse_args()
    plan = load(PLAN, {})
    state = load(STATE, {})
    cases = {x.get('id') for x in (load(CASES, {}).get('items') or [])}
    steps = plan.get('steps') or []
    rows = []
    for s in steps:
        st = (state.get('steps') or {}).get(s['id']) or {}
        rows.append({'id': s['id'], 'title': s.get('title', ''),
                     'status': st.get('status', 'pending'),
                     'cases_ok': all(x in cases for x in s.get('case_ids', [])),
                     'min_cases': int(s.get('min_cases') or 5),
                     'cases': s.get('case_ids', []),
                     'tests': s.get('tests', [])})
    todo = [r for r in rows if r['status'] in ('blocked', 'pending')]
    out = {'ok': not todo, 'current': state.get('current'), 'complete': bool(state.get('complete')),
           'total': len(rows), 'done': sum(1 for r in rows if r['status'] == 'done'),
           'next': todo[0] if todo else None, 'steps': rows}
    if a.json:
        print(json.dumps(out, ensure_ascii=False, indent=1))
    else:
        print('主链接入：%d/%d done，current=%s，complete=%s' % (out['done'], out['total'], out['current'], out['complete']))
        if out['next']:
            n = out['next']
            print('下一步：%s %s' % (n['id'], n['title']))
            print('案例：%s（min=%d，库内=%s）' % (', '.join(n['cases']), n['min_cases'], n['cases_ok']))
            print('测试：')
            for t in n['tests']:
                print('  ' + t)
        else:
            print('没有 pending/blocked 步骤。')
    return 0 if out['ok'] else 1


if __name__ == '__main__':
    sys.exit(main())
