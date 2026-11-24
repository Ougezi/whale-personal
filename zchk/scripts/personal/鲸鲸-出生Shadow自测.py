# -*- coding: utf-8 -*-
"""B6-02 Shadow 指标自测。"""
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(ROOT, 'bridge'))
from shadow import Shadow, assert_window  # noqa: E402

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


def seeded():
    s = Shadow()
    s.record(chat='a', text='x', should_execute=True, clarify=False)
    s.record(chat='a', text='y', should_execute=True, clarify=True)
    s.record(chat='a', text='z', should_execute=False, clarify=False)
    s.record(chat='a', text='w', should_execute=False, clarify=True)
    s.label(0, shouldExecute=True)
    s.label(1, shouldExecute=False)
    s.label(2, shouldExecute=True)
    s.label(3, shouldExecute=False)
    return s


check('只记录不执行', lambda: (_ for _ in ()).throw(AssertionError()) if Shadow().record(chat='a')['executed'] else None)
check('executed 计数 0', lambda: (_ for _ in ()).throw(AssertionError()) if seeded().evaluate()['executed'] != 0 else None)
check('precision 0.5', lambda: (_ for _ in ()).throw(AssertionError()) if seeded().evaluate()['precision'] != 0.5 else None)
check('recall 0.5', lambda: (_ for _ in ()).throw(AssertionError()) if seeded().evaluate()['recall'] != 0.5 else None)
check('澄清率 0.5', lambda: (_ for _ in ()).throw(AssertionError()) if seeded().evaluate()['clarifyRate'] != 0.5 else None)
check('未标注不参与', lambda: (_ for _ in ()).throw(AssertionError()) if (lambda s: (s.record(chat='a'), s.evaluate()['labeled'])[1] != 4)(seeded()) else None)
check('窗口 3 天通过', lambda: (_ for _ in ()).throw(AssertionError()) if not assert_window(0, 3 * 86400000)['ok'] else None)
check('窗口 7 天通过', lambda: (_ for _ in ()).throw(AssertionError()) if not assert_window(0, 7 * 86400000)['ok'] else None)
check('窗口 2 天拒绝', lambda: (_ for _ in ()).throw(AssertionError()) if assert_window(0, 2 * 86400000)['ok'] else None)
check('窗口 8 天拒绝', lambda: (_ for _ in ()).throw(AssertionError()) if assert_window(0, 8 * 86400000)['ok'] else None)
check('日志可序列化', lambda: (_ for _ in ()).throw(AssertionError()) if not json.dumps(seeded().snapshot(), ensure_ascii=False) else None)
check('审计回调', lambda: (lambda rows: (_ for _ in ()).throw(AssertionError()) if len(rows) != 1 else None)((lambda rows: (Shadow(audit=rows.append).record(chat='a'), rows)[1])([])))

print('\n通过 %d/%d' % (pass_n, pass_n + fail_n))
sys.exit(0 if fail_n == 0 else 1)
