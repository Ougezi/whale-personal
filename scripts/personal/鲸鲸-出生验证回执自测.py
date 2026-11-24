# -*- coding: utf-8 -*-
"""B3-04 验证/回执/审计自测。"""
import os
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(ROOT, 'bridge'))
from verify import Verifier  # noqa: E402

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


def fresh():
    return Verifier()



check('成功回执', lambda: (_ for _ in ()).throw(AssertionError()) if fresh().verify(action_id='a', evidence={'readback': 'ok', 'tests': [True], 'diff': 'x'})['receipt']['state'] != 'success' else None)
check('缺证据失败', lambda: (_ for _ in ()).throw(AssertionError()) if fresh().verify(action_id='a')['receipt']['reason'] != 'no-evidence' else None)
check('缺读回失败', lambda: (_ for _ in ()).throw(AssertionError()) if fresh().verify(action_id='a', evidence={'tests': [True]})['receipt']['reason'] != 'no-readback' else None)
check('测试失败可解释', lambda: (_ for _ in ()).throw(AssertionError()) if fresh().verify(action_id='a', evidence={'readback': 'ok', 'tests': [False]})['receipt']['reason'] != 'tests-failed' else None)
check('超时回执', lambda: (_ for _ in ()).throw(AssertionError()) if fresh().verify(action_id='a', timed_out=True)['receipt']['state'] != 'timeout' else None)
check('重复回执幂等', lambda: (lambda v: (_ for _ in ()).throw(AssertionError()) if not (v.verify(action_id='a', evidence={'readback': 'ok', 'tests': [True]}), v.verify(action_id='a'))[1]['duplicate'] else None)(fresh()))
check('任务卡', lambda: (lambda v: (_ for _ in ()).throw(AssertionError()) if not (v.verify(action_id='a', action='改文件', evidence={'readback': 'ok', 'tests': [True]}), v.task_card('a'))[1]['ok'] else None)(fresh()))
check('无回执任务卡', lambda: (_ for _ in ()).throw(AssertionError()) if fresh().task_card('none')['ok'] else None)
check('覆盖率 1.0', lambda: (lambda v: (_ for _ in ()).throw(AssertionError()) if not (v.verify(action_id='a', evidence={'readback': 'ok', 'tests': [True]}), v.coverage(1))[1] == 1.0 else None)(fresh()))
check('覆盖率 0', lambda: (_ for _ in ()).throw(AssertionError()) if fresh().coverage(2) != 0 else None)
check('审计', lambda: (lambda rows: (_ for _ in ()).throw(AssertionError()) if not (Verifier(audit=rows.append).verify(action_id='a', evidence={'readback': 'ok', 'tests': [True]}), rows)[1] else None)([]))
check('统计', lambda: (lambda v: (_ for _ in ()).throw(AssertionError()) if not (v.verify(action_id='a', evidence={'readback': 'ok', 'tests': [True]}), v.stats())[1]['success'] == 1 else None)(fresh()))


def _raises(fn):
    try:
        fn()
    except Exception:
        return True
    return False


check('缺 action_id 拒绝', lambda: (_ for _ in ()).throw(AssertionError()) if not _raises(lambda: fresh().verify(action_id='')) else None)
print('\n通过 %d/%d' % (pass_n, pass_n + fail_n))
sys.exit(0 if fail_n == 0 else 1)
