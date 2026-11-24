# -*- coding: utf-8 -*-
"""B5-01 Command Bus 自测。"""
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(ROOT, 'bridge'))
from command_bus import CommandBus, CommandError  # noqa: E402

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


def bus(**kw):
    return CommandBus(allowed_targets=['wxid_master', 'wxid_friend'], **kw)


check('say 入队', lambda: (_ for _ in ()).throw(AssertionError()) if not bus().dispatch('say', target='wxid_master', text='hi', turn='t1', cid='c1')['ok'] else None)
check('重复 cid 不重复入队', lambda: (lambda b: (_ for _ in ()).throw(AssertionError()) if not (b.dispatch('say', target='wxid_master', text='hi', turn='t1', cid='c1'), b.dispatch('say', target='wxid_master', text='hi2', turn='t2', cid='c1'))[1]['duplicate'] or len(b.outbox) != 1 else None)(bus()))
check('每回合一条 say', lambda: raises(lambda: (lambda b: (b.dispatch('say', target='wxid_master', text='a', turn='t1', cid='c1'), b.dispatch('say', target='wxid_master', text='b', turn='t1', cid='c2')))(bus())))
check('ask 不占 say 位', lambda: (lambda b: (_ for _ in ()).throw(AssertionError()) if not (b.dispatch('say', target='wxid_master', text='a', turn='t1', cid='c1'), b.dispatch('ask', target='wxid_master', text='?', turn='t1', cid='c2'))[1]['ok'] else None)(bus()))
check('未知命令拒绝', lambda: raises(lambda: bus().dispatch('shell', target='wxid_master')))
check('缺 target 拒绝', lambda: raises(lambda: bus().dispatch('say', target='', text='x')))
check('错误接收人拒绝', lambda: raises(lambda: bus().dispatch('say', target='wxid_other', text='x')))
check('act R2 未确认拒绝', lambda: raises(lambda: bus().dispatch('act', target='wxid_master', risk='R2', approved=False)))
check('act R2 已确认放行', lambda: (_ for _ in ()).throw(AssertionError()) if not bus().dispatch('act', target='wxid_master', risk='R2', approved=True, cid='a1')['ok'] else None)
check('风险非法拒绝', lambda: raises(lambda: bus().dispatch('act', target='wxid_master', risk='R9')))
check('stop/remind/remember/forget', lambda: (lambda b: (_ for _ in ()).throw(AssertionError()) if not all(b.dispatch(c, target='wxid_master', cid=c)['ok'] for c in ('stop', 'remind', 'remember', 'forget')) else None)(bus()))
check('审计入队', lambda: (lambda rows: (_ for _ in ()).throw(AssertionError()) if not rows or rows[0].get('action') != 'enqueue' else None)((lambda b: (b.dispatch('say', target='wxid_master', text='hi', turn='t1', cid='c1'), b.history)[1])(bus())))
check('take 清空 outbox', lambda: (lambda b: (_ for _ in ()).throw(AssertionError()) if len(b.take()) != 1 or b.outbox else None)((lambda b: (b.dispatch('say', target='wxid_master', text='hi', turn='t1', cid='c1'), b)[1])(bus())))
check('快照可观测', lambda: (_ for _ in ()).throw(AssertionError()) if bus().snapshot()['seen'] != 0 else None)

print('\n通过 %d/%d' % (pass_n, pass_n + fail_n))
sys.exit(0 if fail_n == 0 else 1)
