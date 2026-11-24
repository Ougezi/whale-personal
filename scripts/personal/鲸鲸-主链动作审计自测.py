# -*- coding: utf-8 -*-
"""I-07 统一动作审计自测。"""
import json
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
FAKE_KEY = 'sk' + '-' + 'ABCD' + 'EFGH' + '12345678'
check('密钥脱敏', lambda: (_ for _ in ()).throw(AssertionError()) if 'sk' + '-' + 'ABCD' in rec(source='brain', goal='key ' + FAKE_KEY)['goal'] else None)
check('时长非负', lambda: (_ for _ in ()).throw(AssertionError()) if rec(source='brain', duration_ms=-5)['durationMs'] != 0 else None)
check('证据截断', lambda: (_ for _ in ()).throw(AssertionError()) if len(rec(source='delegation', evidence=['x'] * 30)['evidence']) > 20 else None)
check('读取最近 N 条', lambda: (_ for _ in ()).throw(AssertionError()) if len(action_audit.read(p, 1)) != 1 else None)

def projection():
    bp = os.path.join(os.path.dirname(p), 'brain-audit.jsonl')
    rec(source='brain', task_id='b1', action='started', status='running')
    rec(source='delegation', task_id='d1', action='delegation_done', status='done')
    n = action_audit.project_brain_audit(p, bp)
    rows = [json.loads(x) for x in open(bp, encoding='utf-8') if x.strip()]
    assert n >= 1
    assert any(r.get('taskId') == 'b1' for r in rows)
    assert not any(r.get('taskId') == 'd1' for r in rows)
    assert all(r.get('projection') is True for r in rows)


check('投影 brain-audit 只含 brain', projection)

print('\n通过 %d/%d' % (pass_n, pass_n + fail_n))
sys.exit(0 if fail_n == 0 else 1)
