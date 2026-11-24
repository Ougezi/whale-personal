# -*- coding: utf-8 -*-
"""B4-03 基因组注册/回滚自测。"""
import copy
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(ROOT, 'bridge'))
from evolution.genome import GenomeRegistry, GenomeError, fingerprint  # noqa: E402

pass_n = 0
fail_n = 0
HASH = 'a' * 64


def check(name, fn):
    global pass_n, fail_n
    try:
        fn()
        pass_n += 1
        print('  ✓ ' + name)
    except Exception as e:
        fail_n += 1
        print('  ✗ ' + name + '  ' + str(e))


def genome(ver):
    return {
        'schemaVersion': 1,
        'constitution': {'path': 'docs/personal/鲸鲸-出生技能-宪法.md', 'hash': HASH, 'readonly': True},
        'identity': {'name': '鲸鲸'},
        'versions': {'genome': ver, 'minSupported': 1, 'rollbackTo': 0},
    }


def raises(fn):
    try:
        fn()
    except Exception:
        return
    raise AssertionError('did not raise')


def fresh():
    return GenomeRegistry(HASH)


check('注册 v1 即 live', lambda: (_ for _ in ()).throw(AssertionError()) if fresh().register(genome(1))['status'] != 'live' else None)


def _v2():
    r = fresh(); r.register(genome(1)); r.register(genome(2))
    assert '2' in r.snapshot()['versions']


check('注册 v2', _v2)


def _canary(score=0.9, errors=0):
    r = fresh(); r.register(genome(1))
    return r.canary(1, {'score': score, 'errors': errors})


check('canary 通过', lambda: (_ for _ in ()).throw(AssertionError()) if not _canary()['ok'] else None)
check('canary 低分拒绝', lambda: (_ for _ in ()).throw(AssertionError()) if _canary(0.5, 0)['ok'] else None)
check('canary 有错拒绝', lambda: (_ for _ in ()).throw(AssertionError()) if _canary(0.99, 1)['ok'] else None)


def _promote_rollback():
    r = fresh(); r.register(genome(1)); r.register(genome(2))
    p = r.promote(2, {'score': 0.9})
    assert p['ok'] and p['version'] == 2
    assert r.rollback()['to'] == 1


check('promote 升级/rollback 回退', _promote_rollback)


def _bad_not_live():
    r = fresh(); r.register(genome(1))
    bad = r.promote(1, {'score': 0.1})
    assert bad['ok'] is False and r.active == 1


check('坏版本不进 live', _bad_not_live)
check('坏 constitution 拒绝', lambda: raises(lambda: fresh().register({**genome(1), 'constitution': {**genome(1)['constitution'], 'readonly': False}})))
check('hash 不匹配拒绝', lambda: raises(lambda: GenomeRegistry('b' * 64).register(genome(1))))
check('版本回退注册拒绝', lambda: raises(lambda: (lambda r: (r.register(genome(2)), r.register(genome(1))))(fresh())))
check('重复版本拒绝', lambda: raises(lambda: (lambda r: (r.register(genome(1)), r.register(genome(1))))(fresh())))
check('freeze 阻断 promote', lambda: raises(lambda: (lambda r: (r.register(genome(1)), r.register(genome(2)), r.freeze(), r.promote(2, {'score': 0.9})))(fresh())))
check('无回滚目标拒绝', lambda: raises(lambda: fresh().rollback()))


def _fail_no_promote():
    r = fresh(); r.register(genome(1)); r.register(genome(2))
    out = r.promote(2, {'score': 0.1})
    assert out['ok'] is False and r.active == 1


check('canary 失败不提升', _fail_no_promote)
check('指纹稳定', lambda: (_ for _ in ()).throw(AssertionError()) if fingerprint(genome(1)) != fingerprint(copy.deepcopy(genome(1))) else None)

print('\n通过 %d/%d' % (pass_n, pass_n + fail_n))
sys.exit(0 if fail_n == 0 else 1)
