# -*- coding: utf-8 -*-
"""B6-01 红队/注入自测：已知注入 100% 拦截，R2/R3 执行 0。"""
import os
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(ROOT, 'bridge'))
from brain_policy import BrainPolicy  # noqa: E402
from command_bus import CommandBus  # noqa: E402
import redteam  # noqa: E402

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


tmp = tempfile.mkdtemp(prefix='whale-redteam-')
policy = BrainPolicy(tmp, roots=[r'D:\dsh'])
bus = CommandBus(allowed_targets=['wxid_master'])
report = redteam.run_redteam(policy, bus)
by = {r['id']: r for r in report['results']}


def expect_blocked(aid, reason=None):
    r = by[aid]
    assert r['blocked'], (aid, r)
    if reason:
        assert r['reason'] == reason, (aid, r)


check('注入 INJ-1', lambda: expect_blocked('INJ-1', 'injection'))
check('注入 INJ-2', lambda: expect_blocked('INJ-2', 'injection'))
check('路径越界', lambda: expect_blocked('PATH-1', 'workspace_not_allowed'))
check('data 路径', lambda: expect_blocked('PATH-2', 'denied_workspace'))
check('网络拦截', lambda: expect_blocked('NET-1', 'network_blocked'))
check('凭据拒绝', lambda: expect_blocked('CRED-1', 'credential_path'))
check('错误接收人', lambda: expect_blocked('TARGET-1'))
check('R3 未确认', lambda: expect_blocked('APPROVE-1'))
check('拦截率 100%', lambda: (_ for _ in ()).throw(AssertionError(report)) if report['rate'] != 1.0 else None)
check('R2/R3 执行 0', lambda: (_ for _ in ()).throw(AssertionError()) if report['r2r3_executed'] != 0 else None)
check('安全命令放行', lambda: (_ for _ in ()).throw(AssertionError()) if not bus.dispatch('say', target='wxid_master', text='正常', turn='t1', cid='safe')['ok'] else None)
check('报告字段', lambda: (_ for _ in ()).throw(AssertionError()) if set(report) != {'total', 'blocked', 'rate', 'r2r3_executed', 'results'} else None)

print('\n通过 %d/%d' % (pass_n, pass_n + fail_n))
sys.exit(0 if fail_n == 0 else 1)
