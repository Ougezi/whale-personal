# -*- coding: utf-8 -*-
"""B4-01 进化提案自测：缺证据拒绝、diff 可读、禁改安全层。"""
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(ROOT, 'bridge'))
from evolution import proposal as P  # noqa: E402

pass_n = 0
fail_n = 0


def check(name, fn):
    global pass_n, fail_n
    try:
        fn()
        pass_n += 1
        print('  ✓ ' + name)
    except Exception as e:
        fail_n += 1
        print('  ✗ ' + name + '  ' + str(e))


BASE = {
    'schemaVersion': 1,
    'id': 'EVO-0001',
    'status': 'review',
    'hypothesis': '把问候语从固定句改成根据时段选择，能减少机械感。',
    'targetLayer': 'prompt',
    'diff': '--- a/prompts/greet.txt\n+++ b/prompts/greet.txt\n@@ -1 +1 @@\n-早上好\n+早上好呀\n',
    'files': ['prompts/greet.txt'],
    'tests': ['python scripts/personal/鲸鲸-出生表达自测.py'],
    'expected': '问候语随时段变化，技术字面不变。',
    'rollback': 'git checkout -- prompts/greet.txt',
    'evidence': ['evidence/greet-before.txt', 'evidence/greet-after.txt'],
    'risk': 'R1',
    'createdAt': 1795527000000,
}


def with_(**kw):
    d = dict(BASE)
    d.update(kw)
    return d


check('合法提案通过', lambda: (_ for _ in ()).throw(AssertionError(P.validate(BASE))) if P.validate(BASE) else None)
check('可进沙箱', lambda: (_ for _ in ()).throw(AssertionError()) if not P.sandbox_ready(BASE) else None)
check('缺 evidence 拒绝', lambda: (_ for _ in ()).throw(AssertionError()) if 'evidence required' not in P.validate(with_(evidence=[])) else None)
check('缺 evidence 不进沙箱', lambda: (_ for _ in ()).throw(AssertionError()) if P.sandbox_ready(with_(evidence=[])) else None)
check('缺 tests 拒绝', lambda: (_ for _ in ()).throw(AssertionError()) if 'tests required' not in P.validate(with_(tests=[])) else None)
check('缺 rollback 拒绝', lambda: (_ for _ in ()).throw(AssertionError()) if 'rollback required' not in P.validate(with_(rollback='')) else None)
check('空 diff 拒绝', lambda: (_ for _ in ()).throw(AssertionError()) if not any(x.startswith('diff unreadable') for x in P.validate(with_(diff=''))) else None)
check('无 hunk 拒绝', lambda: (_ for _ in ()).throw(AssertionError()) if not any('no-hunks' in x for x in P.validate(with_(diff='--- a/x\n+++ b/x\n'))) else None)
check('禁改宪法拒绝', lambda: (_ for _ in ()).throw(AssertionError()) if not any('forbidden target' in x for x in P.validate(with_(files=['docs/personal/鲸鲸-出生技能-宪法.md']))) else None)
check('禁改审计拒绝', lambda: (_ for _ in ()).throw(AssertionError()) if not any('forbidden target' in x for x in P.validate(with_(files=['data/birth-skills/audit.jsonl']))) else None)
check('diff 文件必须声明', lambda: (_ for _ in ()).throw(AssertionError()) if not any('not declared' in x for x in P.validate(with_(files=['other.txt']))) else None)
check('draft 不进沙箱', lambda: (_ for _ in ()).throw(AssertionError()) if P.sandbox_ready(with_(status='draft')) else None)
check('diff 摘要', lambda: (_ for _ in ()).throw(AssertionError()) if P.diff_summary(BASE['diff'])['additions'] != 1 or P.diff_summary(BASE['diff'])['deletions'] != 1 else None)
check('风险非法拒绝', lambda: (_ for _ in ()).throw(AssertionError()) if 'risk invalid' not in P.validate(with_(risk='R9')) else None)

print('\n通过 %d/%d' % (pass_n, pass_n + fail_n))
sys.exit(0 if fail_n == 0 else 1)
