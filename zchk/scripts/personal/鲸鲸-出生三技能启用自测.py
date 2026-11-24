# -*- coding: utf-8 -*-
"""B7-01 三技能启用自测。"""
import json
import os
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(ROOT, 'bridge'))
from birth_config import BirthConfig, BirthConfigError  # noqa: E402

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


def default():
    assert BirthConfig().snapshot()['skills'] == {'grow': False, 'chat': True, 'dsh': True}


def grow_on():
    c = BirthConfig(); c.set_skill('grow', True)
    assert c.snapshot()['skills']['grow'] is True


def independent():
    c = BirthConfig(); c.set_skill('chat', False)
    assert c.snapshot()['skills']['dsh'] is True


def save_load():
    d = tempfile.mkdtemp()
    p = os.path.join(d, 'c.json')
    c = BirthConfig(); c.enable_all(); c.save(p)
    assert BirthConfig.load(p).snapshot()['enabled'] == ['grow', 'chat', 'dsh']


def tampered():
    d = tempfile.mkdtemp(); p = os.path.join(d, 'c.json')
    BirthConfig().save(p)
    open(p, 'w', encoding='utf-8').write(json.dumps({'skills': {'grow': True}, 'constitution': {'readonly': False}}))
    raises(lambda: BirthConfig.load(p))


check('默认安全', default)
check('单独开生长', grow_on)
check('开关独立', independent)
check('全开', lambda: (_ for _ in ()).throw(AssertionError()) if BirthConfig().enable_all()['enabled'] != ['grow', 'chat', 'dsh'] else None)
check('全关', lambda: (_ for _ in ()).throw(AssertionError()) if BirthConfig().disable_all()['enabled'] != [] else None)
check('未知技能拒绝', lambda: raises(lambda: BirthConfig().set_skill('fly', True)))
check('宪法只读', lambda: (_ for _ in ()).throw(AssertionError()) if BirthConfig().snapshot()['constitution']['readonly'] is not True else None)
check('禁止关宪法', lambda: raises(lambda: BirthConfig().try_disable_constitution()))
check('保存/加载', save_load)
check('加载篡改宪法拒绝', tampered)
check('快照 enabled 一致', lambda: (_ for _ in ()).throw(AssertionError()) if BirthConfig().snapshot()['enabled'] != ['chat', 'dsh'] else None)
check('技能名固定', lambda: (_ for _ in ()).throw(AssertionError()) if set(BirthConfig().snapshot()['skills']) != {'grow', 'chat', 'dsh'} else None)
check('默认生长关', lambda: (_ for _ in ()).throw(AssertionError()) if BirthConfig().skills['grow'] else None)

print('\n通过 %d/%d' % (pass_n, pass_n + fail_n))
sys.exit(0 if fail_n == 0 else 1)
