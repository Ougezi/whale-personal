# -*- coding: utf-8 -*-
"""I-04 执行脑 ActionSpec 闸自测。"""
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(ROOT, 'bridge'))
import action_guard as A  # noqa: E402

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


def with_mode(mode, fn):
    old = os.environ.get('WHALE_ACTION_GUARD')
    if mode is None:
        os.environ.pop('WHALE_ACTION_GUARD', None)
    else:
        os.environ['WHALE_ACTION_GUARD'] = mode
    try:
        fn()
    finally:
        if old is None:
            os.environ.pop('WHALE_ACTION_GUARD', None)
        else:
            os.environ['WHALE_ACTION_GUARD'] = old


def ev(tool):
    return {'type': 'tool_call', 'tool': tool, 'input': {}}


def task(approved=False):
    return {'approvedBy': 'owner'} if approved else {}


check('默认关：未知也放行', lambda: with_mode(None, lambda: (_ for _ in ()).throw(AssertionError()) if not A.check_tool(task(), ev('weird'))['ok'] else None))
check('开启：read 放行', lambda: with_mode('1', lambda: (_ for _ in ()).throw(AssertionError()) if A.check_tool(task(), ev('read'))['risk'] != 'R0' else None))
check('开启：write 未批拒绝', lambda: with_mode('1', lambda: (_ for _ in ()).throw(AssertionError()) if A.check_tool(task(), ev('write'))['reason'] != 'approval-required' else None))
check('开启：write 已批放行', lambda: with_mode('1', lambda: (_ for _ in ()).throw(AssertionError()) if not A.check_tool(task(True), ev('write'))['ok'] else None))
check('开启：bash 未批拒绝', lambda: with_mode('1', lambda: (_ for _ in ()).throw(AssertionError()) if A.check_tool(task(), ev('bash'))['reason'] != 'approval-required' else None))
check('开启：未知动作拒绝', lambda: with_mode('1', lambda: (_ for _ in ()).throw(AssertionError()) if A.check_tool(task(), ev('shell'))['reason'] != 'unknown-action' else None))
check('开启：web_fetch 映射 R0', lambda: with_mode('1', lambda: (_ for _ in ()).throw(AssertionError()) if A.check_tool(task(), ev('web_fetch'))['action'] != 'inspect' else None))
check('非 tool_call 放行', lambda: with_mode('1', lambda: (_ for _ in ()).throw(AssertionError()) if not A.check_tool(task(), {'type': 'text'})['ok'] else None))
check('坏形状拒绝', lambda: with_mode('1', lambda: (_ for _ in ()).throw(AssertionError()) if A.check_tool(None, ev('read'))['ok'] else None))
check('关闭后恢复旧行为', lambda: with_mode(None, lambda: (_ for _ in ()).throw(AssertionError()) if not A.check_tool({}, ev('write'))['ok'] else None))

print('\n通过 %d/%d' % (pass_n, pass_n + fail_n))
sys.exit(0 if fail_n == 0 else 1)
