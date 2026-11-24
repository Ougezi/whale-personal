# -*- coding: utf-8 -*-
"""I-07 真实动作复测：真实 DSH 只读任务，产出 delegation_done + brain done 审计。"""
import json
import os
import sys
import time

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DIST = os.path.join(ROOT, 'dist', 'whale-personal')
sys.path.insert(0, os.path.join(DIST, 'bridge'))
os.chdir(DIST)
import action_audit  # noqa: E402
import brain_agent  # noqa: E402
import dsh_agent  # noqa: E402
import receiver_mixin  # noqa: E402

AUDIT = os.path.join(DIST, 'data', 'action-audit.jsonl')
TASK = '只回复 OK 两个字，不要改任何文件，不要运行命令。'


class Resp:
    status_code = 200
    def json(self):
        return {'bubbles': ['ok']}


class HTTP:
    def post(self, *a, **k):
        return Resp()


class Self:
    token = ''
    bot_url = 'http://127.0.0.1:8787/webhook/wechat'
    _paused_chats = set()
    _continue_flag = {}
    _pending_tasks = {}

    def display_name(self, u):
        return '主人'

    def send_text(self, *a, **k):
        return True


print('DSH available:', dsh_agent.available())
receiver_mixin.G.LOCAL_HTTP = HTTP()
receiver_mixin.ReceiverMixin.delegate_and_reply(Self(), TASK, 'audit_real', 'audit_real', force=True, approved=True)
print('delegation done')

import threading
b = brain_agent.BrainAgent(send=lambda *a, **k: True, record=lambda *a, **k: None, log=lambda *a, **k: None)
b.master = 'audit_real'
b._start('audit_real', TASK, mode='read-only')
deadline = time.time() + 120
while time.time() < deadline:
    st = b._state['tasks']
    if st and all(t.get('status') not in ('queued', 'running', 'pending_approval') for t in st.values()):
        break
    time.sleep(1)
print('brain done')

rows = [json.loads(x) for x in open(AUDIT, encoding='utf-8') if x.strip()]
for r in rows[-12:]:
    print(r.get('at'), r.get('source'), r.get('action'), r.get('status'))
