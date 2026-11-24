# -*- coding: utf-8 -*-
"""P3：birth/rollout/genome/sandbox/redteam 自测。"""
import json
import os
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(ROOT, 'bridge'))
import platform_control as C
from platform_broker import PlatformBroker
from birth_config import BirthConfig

PASS = FAIL = 0


def check(n, fn):
    global PASS, FAIL
    try:
        fn(); PASS += 1; print('  ✓ ' + n)
    except Exception as e:
        FAIL += 1; print('  ✗ ' + n + '  ' + str(e))


class A:
    def __init__(self):
        self.calls = 0
    def available(self): return {'ok': True}
    def capabilities(self): return [{'op': 'x', 'risk': 'R1'}]
    def execute(self, op, args=None): self.calls += 1; return {'ok': True, 'text': 'ok', 'evidence': {'readback': 'r', 'tests': ['t']}}


def main():
    d = tempfile.mkdtemp(prefix='whale-p3-test-')
    check('birth default dsh', lambda: (_ for _ in ()).throw(AssertionError('bad')) if C.birth_status(d)['skills'].get('dsh') is not True else None)
    C.birth_set(d, 'dsh', 0)
    check('birth dsh off', lambda: (_ for _ in ()).throw(AssertionError('bad')) if C.birth_status(d)['skills'].get('dsh') is not False else None)
    a = A(); b = PlatformBroker({'x': a}, birth=BirthConfig({'dsh': False}))
    check('broker skill-disabled', lambda: (_ for _ in ()).throw(AssertionError('bad')) if b.dispatch('x', 'x', {}).get('code') != 'skill-disabled' else None)
    C.rollout_set(d, 'x', 0)
    b2 = PlatformBroker({'x': a}, rollout={'x': 0})
    check('rollout 0 blocked', lambda: (_ for _ in ()).throw(AssertionError('bad')) if b2.dispatch('x', 'x', {}).get('code') != 'rollout-blocked' else None)
    b3 = PlatformBroker({'x': a}, rollout={'x': 100})
    check('rollout 100 allows', lambda: (_ for _ in ()).throw(AssertionError('bad')) if not b3.dispatch('x', 'x', {}).get('ok') else None)
    g = C.genome_register(d, 1)
    check('genome register', lambda: (_ for _ in ()).throw(AssertionError('bad')) if not g.get('ok') or len(g.get('fingerprint') or '') != 64 else None)
    check('genome status', lambda: (_ for _ in ()).throw(AssertionError('bad')) if not C.genome_status(d).get('ok') else None)
    sd = tempfile.mkdtemp(prefix='whale-p3-sb-')
    open(os.path.join(sd, 'a.txt'), 'w', encoding='utf-8').write('x\n')
    diff = '--- a/a.txt\n+++ b/a.txt\n@@ -1 +1 @@\n-x\n+y\n'
    sr = C.sandbox_run(sd, ['a.txt'], diff, {'a.txt': 'y\n'})
    check('sandbox pass + main unchanged', lambda: (_ for _ in ()).throw(AssertionError('bad')) if not sr.get('ok') or not sr.get('mainUnchanged') else None)
    rt = C.redteam_run()
    check('redteam blocks', lambda: (_ for _ in ()).throw(AssertionError('bad')) if not rt.get('blocked') else None)
    print('\n通过 %d/%d' % (PASS, PASS + FAIL))
    return 0 if FAIL == 0 else 1


if __name__ == '__main__':
    sys.exit(main())
