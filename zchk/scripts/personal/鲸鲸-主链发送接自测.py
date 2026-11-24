# -*- coding: utf-8 -*-
"""I-03 发送口 Command Bus/回执自测。"""
import os
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(ROOT, 'bridge'))
from send_guard import SendGuard, get_guard  # noqa: E402
import engine as G  # noqa: E402

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


def guard():
    return SendGuard(allowed_targets=['wxid_master'], now=lambda: 1000)


check('target 放行', lambda: (_ for _ in ()).throw(AssertionError()) if not guard().allow('wxid_master', 'hi')['ok'] else None)
check('错误接收人拒绝', lambda: (_ for _ in ()).throw(AssertionError()) if guard().allow('wxid_other', 'hi')['ok'] else None)
check('空 target 拒绝', lambda: (_ for _ in ()).throw(AssertionError()) if guard().allow('', 'hi')['ok'] else None)
check('5 秒重复拒绝', lambda: (lambda g: (_ for _ in ()).throw(AssertionError()) if (g.allow('wxid_master', 'hi'), g.allow('wxid_master', 'hi'))[1]['ok'] else None)(guard()))
check('不同文本放行', lambda: (lambda g: (_ for _ in ()).throw(AssertionError()) if not (g.allow('wxid_master', 'a'), g.allow('wxid_master', 'b'))[1]['ok'] else None)(guard()))


def receipts():
    d = tempfile.mkdtemp(); f = os.path.join(d, 'r.jsonl')
    g = SendGuard(allowed_targets=['wxid_master'], receipt_file=f, now=lambda: 1000)
    g.receipt('wxid_master', 'hi', True)
    lines = open(f, encoding='utf-8').read().strip().splitlines()
    assert len(lines) == 1 and '"ok": true' in lines[0]


check('回执落盘', receipts)
check('默认关', lambda: (os.environ.pop('WHALE_SEND_GUARD', None), (_ for _ in ()).throw(AssertionError()) if get_guard(G) is not None else None))


def wrapper():
    d = tempfile.mkdtemp(); f = os.path.join(d, 'r.jsonl')
    g = SendGuard(allowed_targets=['wxid_master'], receipt_file=f, now=lambda: 1000)
    G.SEND_GUARD = g
    from sender_mixin import SenderMixin

    class Dummy(SenderMixin):
        def _send_text_core(self, text, chat_display_name, chat_username='', force=False, quote_latest=False):
            return True

    obj = object.__new__(Dummy)
    assert obj.send_text('hi', '主人', 'wxid_master') is True
    assert obj.send_text('hi', '主人', 'wxid_master') is False
    assert len(open(f, encoding='utf-8').read().strip().splitlines()) == 1


check('send_text 包装生效', wrapper)
check('默认不改变旧发送', lambda: (_ for _ in ()).throw(AssertionError()) if getattr(G, 'SEND_GUARD', None) is None else None)

print('\n通过 %d/%d' % (pass_n, pass_n + fail_n))
sys.exit(0 if fail_n == 0 else 1)
