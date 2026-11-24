# -*- coding: utf-8 -*-
"""I-08 核心包接入矩阵自测。"""
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(ROOT, 'scripts', 'personal'))
from importlib import import_module
M = import_module('鲸鲸-核心包接入检查')

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


d = M.load()


def by_id(i):
    return next(p for p in d['packages'] if p['id'] == i)


check('11 个 Node 包', lambda: (_ for _ in ()).throw(AssertionError()) if len(d['packages']) != 11 else None)
check('11 个桥接契约', lambda: (_ for _ in ()).throw(AssertionError()) if len(d['bridge_contracts']) != 13 else None)
check('events wired', lambda: (_ for _ in ()).throw(AssertionError()) if by_id('events')['status'] != 'wired' else None)
check('working wired', lambda: (_ for _ in ()).throw(AssertionError()) if by_id('working')['status'] != 'wired' else None)
check('retrieval wired', lambda: (_ for _ in ()).throw(AssertionError()) if by_id('retrieval')['status'] != 'wired' else None)
check('状态合法', lambda: (_ for _ in ()).throw(AssertionError()) if any(p['status'] not in ('wired', 'not-wired') for p in d['packages'] + d['bridge_contracts']) else None)
check('文件都存在', lambda: (_ for _ in ()).throw(AssertionError()) if any(not os.path.isfile(os.path.join(ROOT, p['path'])) for p in d['packages'] + d['bridge_contracts']) else None)
check('wired 有测试文件', lambda: (_ for _ in ()).throw(AssertionError()) if any(not os.path.isfile(os.path.join(ROOT, p['test'])) for p in d['packages'] if p['status'] == 'wired') else None)
check('检查器通过', lambda: (_ for _ in ()).throw(AssertionError()) if not M.check()['ok'] else None)

print('\n通过 %d/%d' % (pass_n, pass_n + fail_n))
sys.exit(0 if fail_n == 0 else 1)
