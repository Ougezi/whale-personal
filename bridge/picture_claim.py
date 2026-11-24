# -*- coding: utf-8 -*-
"""发图声明纠偏。

模型在图片还没发出去时容易说“图发过去了”。桥接能区分：
  - will_send：主人私聊 + [[pic:]]，图会异步发
  - blocked：非主人/群聊，图不会发
  - no_marker：没有 [[pic:]]，本轮不会发图
只改写“已发送”类声明，不改否定句和普通聊天。
"""
import re

CLAIM_RE = re.compile(
    r'(?:图|图片|照片)(?:我)?(?:已经|刚|这边)?'
    r'(?:发过去|发给你|发了|传过去|传给你|拍好了|拍给你)'
    r'[^。！？\n]*[。！？]?'
)
NEG = re.compile(r'没|未|不|失败|发不出|没发|没收到')


def scrub(text, mode='no_marker'):
    t = str(text or '')
    if not t:
        return t
    if mode == 'will_send':
        repl = '我去找一张，稍等。'
    elif mode == 'blocked':
        repl = '这个会话发不了图，我用文字说。'
    else:
        repl = '图我还没发出去，我找找怎么发。'

    def sub(m):
        s = m.group(0)
        return s if NEG.search(s) else repl

    out = CLAIM_RE.sub(sub, t).strip()
    out = re.sub(r'[，,、]\s*[。！？!?]', '。', out)
    out = re.sub(r'\n{2,}', '\n', out).strip()
    return out


def append_blocked_note(text):
    t = str(text or '').strip()
    if not t:
        return '这个会话发不了图，我用文字说。'
    if '不能发图' in t or '发不了图' in t:
        return t
    return t.rstrip('。！ ') + '（这个会话发不了图，我用文字说）'
