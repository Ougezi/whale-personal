# -*- coding: utf-8 -*-
"""I-04：执行脑工具口 ActionSpec 闸。

默认关（WHALE_ACTION_GUARD=1 才启用）。
  - read/read_image/glob/grep -> inspect R0
  - write/edit -> edit R2
  - bash/pwsh -> run_test R2
  - 未知工具 -> unknown-action
  - R2/R3 必须 task.approvedBy（approve() 时写入）
失败只拦本条工具调用，不改变原有路径/网络守卫。
"""
import os

SPECS = {
    'read': ('inspect', 'R0'),
    'read_image': ('inspect', 'R0'),
    'glob': ('inspect', 'R0'),
    'grep': ('inspect', 'R0'),
    'write': ('edit', 'R2'),
    'edit': ('edit', 'R2'),
    'bash': ('run_test', 'R2'),
    'pwsh': ('run_test', 'R2'),
    'web_fetch': ('inspect', 'R0'),
    'web_search': ('inspect', 'R0'),
}


def enabled():
    return os.environ.get('WHALE_ACTION_GUARD') == '1'


def classify(tool):
    return SPECS.get(str(tool or ''), None)


def check_tool(task, ev):
    """返回 {ok, reason, action, risk}；不执行工具。"""
    if not enabled():
        return {'ok': True, 'reason': 'disabled', 'action': '', 'risk': ''}
    if not isinstance(task, dict) or not isinstance(ev, dict):
        return {'ok': False, 'reason': 'bad-shape', 'action': '', 'risk': ''}
    if ev.get('type') != 'tool_call':
        return {'ok': True, 'reason': 'not-tool', 'action': '', 'risk': ''}
    tool = str(ev.get('tool') or '')
    spec = classify(tool)
    if not spec:
        return {'ok': False, 'reason': 'unknown-action', 'action': tool, 'risk': 'R3'}
    action, risk = spec
    if risk in ('R2', 'R3') and not task.get('approvedBy'):
        return {'ok': False, 'reason': 'approval-required', 'action': action, 'risk': risk}
    return {'ok': True, 'reason': 'ok', 'action': action, 'risk': risk}
