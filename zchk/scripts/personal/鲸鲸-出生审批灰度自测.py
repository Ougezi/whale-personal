# -*- coding: utf-8 -*-
"""B4-04 审批/灰度自测。"""
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(ROOT, 'bridge'))
from evolution.approval import Approval, ApprovalError  # noqa: E402

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


def raises(fn):
    try:
        fn()
    except Exception:
        return
    raise AssertionError('did not raise')


check('R2 未批不能 canary', lambda: raises(lambda: Approval('a', 'R2', evidence=['e']).enter_canary()))
check('R2 一批可 canary', lambda: (_ for _ in ()).throw(AssertionError()) if (lambda a: (a.approve('owner'), a.enter_canary())[1]['stage'] != 'canary')(Approval('a', 'R2', evidence=['e'])) else None)
check('R3 一批不够', lambda: (_ for _ in ()).throw(AssertionError()) if (lambda a: (a.approve('owner'), a.snapshot())[1]['state'] != 'pending')(Approval('a', 'R3', evidence=['e'])) else None)
check('R3 两批通过', lambda: (_ for _ in ()).throw(AssertionError()) if (lambda a: (a.approve('o1'), a.approve('o2'), a.snapshot())[2]['state'] != 'approved')(Approval('a', 'R3', evidence=['e'])) else None)
check('无证据不能 canary', lambda: raises(lambda: (lambda a: (a.approve('owner'), a.enter_canary()))(Approval('a', 'R2'))))
check('canary→live', lambda: (_ for _ in ()).throw(AssertionError()) if (lambda a: (a.approve('owner'), a.enter_canary(), a.promote_live({'score': .9, 'errorRate': 0}))[2]['ok'] is not True)(Approval('a', 'R2', evidence=['e'])) else None)
check('指标不达标回滚', lambda: (_ for _ in ()).throw(AssertionError()) if (lambda a: (a.approve('owner'), a.enter_canary(), a.promote_live({'score': .5, 'errorRate': 0}))[2]['stage'] != 'shadow')(Approval('a', 'R2', evidence=['e'])) else None)
def fail_no_live():
    a = Approval('a', 'R2', evidence=['e'])
    a.approve('owner'); a.enter_canary()
    out = a.promote_live({'score': .5})
    assert out['ok'] is False and out['stage'] == 'shadow'


check('指标不达标不 live', fail_no_live)
check('stop', lambda: (_ for _ in ()).throw(AssertionError()) if (lambda a: (a.stop(), a.snapshot())[1]['state'] != 'stopped')(Approval('a', 'R2', evidence=['e'])) else None)
check('stop 后 approve 拒绝', lambda: raises(lambda: (lambda a: (a.stop(), a.approve('owner')))(Approval('a', 'R2', evidence=['e']))))
check('R0 自动 approved', lambda: (_ for _ in ()).throw(AssertionError()) if Approval('a', 'R0').state != 'approved' else None)
check('重复批准不重复计数', lambda: (_ for _ in ()).throw(AssertionError()) if (lambda a: (a.approve('o'), a.approve('o'), a.snapshot())[2]['approvals'] != ['o'])(Approval('a', 'R3', evidence=['e'])) else None)
check('未知风险拒绝', lambda: raises(lambda: Approval('a', 'R9')))

print('\n通过 %d/%d' % (pass_n, pass_n + fail_n))
sys.exit(0 if fail_n == 0 else 1)
