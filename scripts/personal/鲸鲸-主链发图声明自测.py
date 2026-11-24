# -*- coding: utf-8 -*-
"""截图回归：图片没发出去时，不许说“图发过去了”。"""
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(ROOT, 'bridge'))
import picture_claim as P

PASS = FAIL = 0


def check(n, cond):
    global PASS, FAIL
    if cond:
        PASS += 1; print('  ✓ ' + n)
    else:
        FAIL += 1; print('  ✗ ' + n)


def main():
    check('master marker 改未来时', P.scrub('图发过去了，收到了吗？', 'will_send') == '我去找一张，稍等。')
    check('non-master 改不能发', P.scrub('图发过去了，收到了吗？', 'blocked') == '这个会话发不了图，我用文字说。')
    check('no marker 改未发', P.scrub('图发过去了，收到了吗？', 'no_marker') == '图我还没发出去，我找找怎么发。')
    check('否定句不改', P.scrub('图没发出去，我重新拍。', 'blocked') == '图没发出去，我重新拍。')
    check('普通聊天不改', P.scrub('今天有点累。', 'blocked') == '今天有点累。')
    check('blocked 附加说明', '发不了图' in P.append_blocked_note('好，我去看看'))
    print('\n通过 %d/%d' % (PASS, PASS + FAIL))
    return 0 if FAIL == 0 else 1


if __name__ == '__main__':
    sys.exit(main())
