# -*- coding: utf-8 -*-
"""I-12 回执 JSONL 轮转自测。"""
import os
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(ROOT, 'bridge'))
import send_guard  # noqa: E402

pass_n = 0
fail_n = 0


def check(name, fn):
    global pass_n, fail_n
    try:
        fn(); pass_n += 1; print('  ✓ ' + name)
    except Exception as e:
        fail_n += 1; print('  ✗ ' + name + '  ' + str(e))


tmp = tempfile.mkdtemp()
p = os.path.join(tmp, 'receipts.jsonl')
open(p, 'w', encoding='utf-8').write('x' * (5 * 1024 * 1024 + 1))
check('大回执触发轮转', lambda: (_ for _ in ()).throw(AssertionError()) if not send_guard._rotate(p) else None)
check('生成 .1', lambda: (_ for _ in ()).throw(AssertionError()) if not os.path.exists(p + '.1') else None)
g = send_guard.SendGuard(allowed_targets=['wxid_m'], receipt_file=p, now=lambda: 1000)
g.allow('wxid_m', 'hello')
g.receipt('wxid_m', 'hello', True, 'sent')
check('轮转后仍写回执', lambda: (_ for _ in ()).throw(AssertionError()) if 'wxid_m' not in open(p, encoding='utf-8').read() else None)
check('回执可读', lambda: (_ for _ in ()).throw(AssertionError()) if not g.rows else None)
check('无 .2 时不报错', lambda: (_ for _ in ()).throw(AssertionError()) if send_guard._rotate(os.path.join(tmp, 'none.jsonl')) else None)

print('\n通过 %d/%d' % (pass_n, pass_n + fail_n))
sys.exit(0 if fail_n == 0 else 1)
