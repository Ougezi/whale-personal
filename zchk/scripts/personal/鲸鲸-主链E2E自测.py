# -*- coding: utf-8 -*-
"""I-05 构建产物 E2E：dist 的发送闸 + 动作闸。"""
import os
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DIST = os.path.join(ROOT, 'dist', 'whale-personal')
sys.path.insert(0, os.path.join(DIST, 'bridge'))
import send_guard  # noqa: E402
import action_guard  # noqa: E402

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


def guard():
    return send_guard.SendGuard(allowed_targets=['wxid_master'], now=lambda: 1000)


check('dist SendGuard 白名单', lambda: (_ for _ in ()).throw(AssertionError()) if not guard().allow('wxid_master', 'hi')['ok'] else None)
check('dist SendGuard 错误人', lambda: (_ for _ in ()).throw(AssertionError()) if guard().allow('wxid_other', 'hi')['ok'] else None)
check('dist SendGuard 重复', lambda: (lambda g: (_ for _ in ()).throw(AssertionError()) if (g.allow('wxid_master', 'x'), g.allow('wxid_master', 'x'))[1]['ok'] else None)(guard()))
def receipt():
    f = os.path.join(tempfile.mkdtemp(), 'r.jsonl')
    g = send_guard.SendGuard(allowed_targets=['wxid_master'], receipt_file=f, now=lambda: 1000)
    g.receipt('wxid_master', 'x', True)
    assert os.path.exists(f)


check('dist receipt', receipt)
check('dist ActionGuard 默认关', lambda: (_ for _ in ()).throw(AssertionError()) if os.environ.pop('WHALE_ACTION_GUARD', None) is not None and not action_guard.check_tool({}, {'type': 'tool_call', 'tool': 'weird'})['ok'] else None)
check('dist ActionGuard 未知拒绝', lambda: (os.environ.__setitem__('WHALE_ACTION_GUARD', '1'), (_ for _ in ()).throw(AssertionError()) if action_guard.check_tool({}, {'type': 'tool_call', 'tool': 'weird'})['reason'] != 'unknown-action' else None)[1])
check('dist ActionGuard 未批拒绝', lambda: (os.environ.__setitem__('WHALE_ACTION_GUARD', '1'), (_ for _ in ()).throw(AssertionError()) if action_guard.check_tool({}, {'type': 'tool_call', 'tool': 'write'})['reason'] != 'approval-required' else None)[1])

print('\n通过 %d/%d' % (pass_n, pass_n + fail_n))
sys.exit(0 if fail_n == 0 else 1)
