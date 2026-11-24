# -*- coding: utf-8 -*-
"""出生技能执行计划门禁校验器。

只校验计划和案例，不执行 26 步本身；真正的执行由 whale-birth-skills skill 带着做。
用法：
  python scripts/personal/鲸鲸-出生技能自测.py
"""
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
PLAN = os.path.join(ROOT, 'docs', 'personal', '鲸鲸-出生技能-执行计划.json')
CASES = os.path.join(ROOT, 'docs', 'personal', '鲸鲸-出生技能-案例库-313.json')
SKILL = os.path.join(ROOT, 'skills', 'whale-birth-skills', 'SKILL.md')

PASS = 0
FAIL = 0


def check(name, ok, detail=''):
    global PASS, FAIL
    if ok:
        PASS += 1
        print('  ✓ %-34s %s' % (name, detail))
    else:
        FAIL += 1
        print('  ✗ %-34s %s' % (name, detail))


def main():
    print('=== 出生技能执行计划门禁 ===')
    try:
        plan = json.load(open(PLAN, encoding='utf-8'))
        corpus = json.load(open(CASES, encoding='utf-8'))
    except Exception as e:
        print('读取失败：%r' % e)
        return 1

    by_id = {x['id']: x for x in corpus.get('items', [])}
    steps = plan.get('steps', [])
    check('案例库 ≥300', len(by_id) >= 300, 'count=%d' % len(by_id))
    check('步骤数 = 26', len(steps) == 26, 'count=%d' % len(steps))
    check('阶段数 = 8', len(plan.get('phases', [])) == 8, 'phases=%s' % ','.join(plan.get('phases', [])))
    check('每步案例下限 ≥5', int(plan.get('case_gate', {}).get('min_cases_per_step', 0)) >= 5)
    check('禁止 0 案例', bool(plan.get('case_gate', {}).get('no_step_without_cases')))
    check('skill 存在', os.path.isfile(SKILL), SKILL)

    missing = []
    low = []
    for s in steps:
        ids = s.get('case_ids') or []
        if len(ids) < int(s.get('min_cases') or 5):
            low.append(s.get('id'))
        for cid in ids:
            if cid not in by_id:
                missing.append('%s:%s' % (s.get('id'), cid))
    check('每步案例达标', not low, ','.join(low) or 'all ok')
    check('案例 ID 全部存在', not missing, ','.join(missing[:3]) or 'all ok')

    sr_ok = all(isinstance(s.get('source_review'), list) for s in steps)
    check('源码字段是列表', sr_ok)
    check('有源码步骤', sum(1 for s in steps if s.get('source_review')) >= 10)

    # 每个阶段的步骤都存在
    phases = set(plan.get('phases', []))
    step_phases = set(s.get('phase') for s in steps)
    check('阶段覆盖完整', phases == step_phases, ','.join(sorted(phases ^ step_phases)) or 'all ok')

    print('\n通过 %d/%d' % (PASS, PASS + FAIL))
    return 1 if FAIL else 0


if __name__ == '__main__':
    sys.exit(main())
