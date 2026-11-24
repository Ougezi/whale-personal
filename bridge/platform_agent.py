# -*- coding: utf-8 -*-
"""P0 · 平台标记执行入口。

这条链默认关闭：只有 WHALE_PLATFORM_CALLS=1 才认 [[gh:...]] / [[bili:...]]。
标记从回复正文里剥掉，结果作为“执行端回报”交给内核转述。
"""
import os
import re

try:
    from .platform_broker import PlatformBroker
    from .platform_github import GitHubAdapter
    from .platform_bilibili import BilibiliAdapter
    from .shadow import Shadow
except Exception:
    from platform_broker import PlatformBroker
    from platform_github import GitHubAdapter
    from platform_bilibili import BilibiliAdapter
    from shadow import Shadow

MARKER_RE = re.compile(r'\[\[(gh|bili):\s*(.+?)(?:\]\]|$)', re.S)
_warned = False


def enabled():
    return str(os.environ.get('WHALE_PLATFORM_CALLS') or '').strip() == '1'


def broker():
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    data = os.environ.get('WHALE_PLATFORM_DATA_DIR') or os.path.join(root, 'data')
    sh = Shadow() if str(os.environ.get('WHALE_PLATFORM_SHADOW') or '') == '1' else None
    return PlatformBroker({'github': GitHubAdapter(), 'bilibili': BilibiliAdapter()},
                          shadow=sh, receipt_path=os.path.join(data, 'platform-receipts.jsonl'))


def extract(text):
    """从回复里剥掉平台标记；返回 (clean, spec_or_empty)。"""
    s = str(text or '')
    if not enabled():
        return s, ''
    m = MARKER_RE.search(s)
    if not m:
        return s, ''
    spec = '%s:%s' % (m.group(1), m.group(2).strip())
    clean = MARKER_RE.sub('', s).strip()
    if len(clean) < 4:
        clean = '好，我去查。'
    return clean, spec


def run(spec, timeout=None):
    """执行一个标记；只读。返回 (ok, text)。"""
    if not enabled():
        return False, '平台调用未开启（设置 WHALE_PLATFORM_CALLS=1 后重启桥接）'
    out = broker().dispatch_spec(spec)
    if out.get('shadow'):
        return False, '已记录 shadow，未执行（这不是查询结果，别当成事实）'
    return bool(out.get('ok')), str(out.get('text') or ('平台返回失败：' + str(out.get('code') or 'unknown')))
