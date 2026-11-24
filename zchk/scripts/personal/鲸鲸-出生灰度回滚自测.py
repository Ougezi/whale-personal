# -*- coding: utf-8 -*-
"""B6-03 灰度/回滚自测。"""
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(ROOT, 'bridge'))
from rollout import Rollout, RolloutError, ROLLBACK_BUDGET_MS  # noqa: E402

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
    clock = [1000]
    return Rollout(now=lambda: clock[0]), clock


check('初始 0%', lambda: (_ for _ in ()).throw(AssertionError()) if fresh()[0].percent != 0 else None)
check('10% -> 50% -> 100%', lambda: (lambda r: (_ for _ in ()).throw(AssertionError()) if [r.advance({'score': .9})['percent'] for _ in range(3)] != [10, 50, 100] else None)(fresh()[0]))
check('指标差阻断', lambda: (_ for _ in ()).throw(AssertionError()) if fresh()[0].advance({'errorRate': .1})['ok'] else None)
check('分数低阻断', lambda: (_ for _ in ()).throw(AssertionError()) if fresh()[0].advance({'score': .5})['ok'] else None)
check('kill 随时可停', lambda: (lambda r: (_ for _ in ()).throw(AssertionError()) if not (r.advance({'score': .9}), r.kill())[1]['ok'] or r.percent != 0 else None)(fresh()[0]))

# 上面一条用了复杂表达式，单独用更清晰的方式重测
def kill_then_advance():
    r, _ = fresh(); r.advance({'score': .9}); r.kill()
    try:
        r.advance({'score': .9})
    except RolloutError:
        return
    raise AssertionError('did not raise')


check('kill 后不能推进（清晰）', kill_then_advance)
check('回滚 <5min', lambda: (lambda r: (_ for _ in ()).throw(AssertionError()) if not (r.advance({'score': .9}), r.rollback(at=2000))[1]['ok'] else None)(fresh()[0]))
check('回滚超预算失败', lambda: (lambda r: (_ for _ in ()).throw(AssertionError()) if (r.advance({'score': .9}), r.rollback(at=1000 + ROLLBACK_BUDGET_MS + 1))[1]['ok'] else None)(fresh()[0]))
check('回滚数据不丢', lambda: (lambda r: (_ for _ in ()).throw(AssertionError()) if not (r.add_data('a'), r.add_data('b'), r.advance({'score': .9}), r.rollback())[3]['data'] == 2 else None)(fresh()[0]))
def history_rows():
    r, _ = fresh(); r.advance({'score': .9}); r.kill()
    assert r.history


check('历史留痕', history_rows)
check('快照', lambda: (_ for _ in ()).throw(AssertionError()) if 'history' not in fresh()[0].snapshot() else None)
check('回滚后 percent=0', lambda: (lambda r: (_ for _ in ()).throw(AssertionError()) if not (r.advance({'score': .9}), r.rollback())[1]['percent'] == 0 else None)(fresh()[0]))

print('\n通过 %d/%d' % (pass_n, pass_n + fail_n))
sys.exit(0 if fail_n == 0 else 1)
