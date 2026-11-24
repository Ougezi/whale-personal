# -*- coding: utf-8 -*-
"""I-07 统一动作审计自测。"""
import os
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(ROOT, 'bridge'))
import action_audit  # noqa: E402

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


p = os.path.join(tempfile.mkdtemp(), 'action-audit.jsonl')


def rec(**kw):
    return action_audit.record(path=p, **kw)


check('brain 写入', lambda: (_ for _ in ()).throw(AssertionError()) if rec(source='brain', action='started', status='running')['source'] != 'brain' else None)
check('delegation 写入', lambda: (_ for _ in ()).throw(AssertionError()) if rec(source='delegation', action='delegation_done', status='done')['source'] != 'delegation' else None)
check('JSONL 两行', lambda: (_ for _ in ()).throw(AssertionError()) if len(open(p, encoding='utf-8').read().strip().splitlines()) < 2 else None)
check('统一 schema', lambda: (_ for _ in ()).throw(AssertionError()) if set(action_audit.read(p, 1)[0]) != {'v', 'at', 'source', 'taskId', 'chat', 'action', 'status', 'risk', 'mode', 'goal', 'reason', 'durationMs', 'evidence'} else None)
check('密钥脱敏', lambda: (_ for _ in ()).throw(AssertionError()) if 'sk-ABCDEFGH' in rec(source='brain', goal='key sk-ABCDEFGH12345678')['goal'] else None)
check('时长非负', lambda: (_ for _ in ()).throw(AssertionError()) if rec(source='brain', duration_ms=-5)['durationMs'] != 0 else None)
check('证据截断', lambda: (_ for _ in ()).throw(AssertionError()) if len(rec(source='delegation', evidence=['x'] * 30)['evidence']) > 20 else None)
check('读取最近 N 条', lambda: (_ for _ in ()).throw(AssertionError()) if len(action_audit.read(p, 1)) != 1 else None)

print('\n通过 %d/%d' % (pass_n, pass_n + fail_n))
sys.exit(0 if fail_n == 0 else 1)
