# -*- coding: utf-8 -*-
"""回归：主动搭话 UIA submitted 也必须进上下文，否则下一轮会“失忆”。"""
import os

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
loop = open(os.path.join(ROOT, 'bridge', 'loop_mixin.py'), encoding='utf-8').read()
care = open(os.path.join(ROOT, 'src', 'http', 'routes', 'care.js'), encoding='utf-8').read()
PASS = FAIL = 0


def check(n, c):
    global PASS, FAIL
    if c:
        PASS += 1; print('  ✓ ' + n)
    else:
        FAIL += 1; print('  ✗ ' + n)


check('loop 接受 submitted', "'submitted'" in loop and "_care_status in ('confirmed', 'submitted')" in loop)
check('receipt 带 delivery', "'delivery': _care_status" in loop)
check('route 保存 delivery', 'deliveryUncertain' in care and 'delivery' in care)
check('未确认标记', 'deliveryUncertain: delivery !==' in care)
print('\n通过 %d/%d' % (PASS, PASS + FAIL))
raise SystemExit(0 if FAIL == 0 else 1)
