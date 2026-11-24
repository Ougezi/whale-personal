# -*- coding: utf-8 -*-
"""I-18：真实 DSH 写任务 + 硬审批（不是 fake DSH）。"""
import json
import os
import sys
import time

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DIST = os.path.join(ROOT, 'dist', 'whale-personal')
sys.path.insert(0, os.path.join(DIST, 'bridge'))
os.chdir(DIST)
import delegation_approval as A  # noqa: E402
import dsh_agent  # noqa: E402
import receiver_mixin  # noqa: E402

TARGET = os.path.join(DIST, 'i18-e2e.txt')
TASK = '把 %s 的内容改成 i18-ok，只改这一个文件。' % TARGET


class Resp:
    status_code = 200
    def json(self): return {'bubbles': ['ok']}


class HTTP:
    def post(self, *a, **k): return Resp()


class Self:
    token = ''
    bot_url = 'http://127.0.0.1:8787/webhook/wechat'
    _paused_chats = set()
    _continue_flag = {}
    _pending_tasks = {}
    def __init__(self): self.sent = []
    def display_name(self, u): return '主人'
    def send_text(self, t, *a, **k): self.sent.append(str(t)); return True
    def _post_job(self, ops): return None


receiver_mixin.G.LOCAL_HTTP = HTTP()
try: os.remove(TARGET)
except FileNotFoundError: pass
with open(TARGET, 'w', encoding='utf-8') as f: f.write('before-i18')

s = Self()
receiver_mixin.ReceiverMixin.delegate_and_reply(s, TASK, 'i18', 'i18', force=True)
assert A.pending('i18'), 'should be pending'
assert open(TARGET, encoding='utf-8').read() == 'before-i18', 'must not write before approval'
print('approval prompt:', any('动文件' in x for x in s.sent))

d = A.consume('i18', '可以')
assert d and d['action'] == 'approve'
receiver_mixin.ReceiverMixin.delegate_and_reply(s, TASK, 'i18', 'i18', force=True, approved=True)
time.sleep(1)
content = open(TARGET, encoding='utf-8').read().strip()
print('content:', content)
assert content == 'i18-ok', content
rows = [json.loads(x) for x in open(os.path.join(DIST, 'data', 'action-audit.jsonl'), encoding='utf-8') if x.strip()]
assert any(r.get('action') == 'delegation_done' and r.get('status') == 'done' for r in rows)
print('real write approval: PASS')
