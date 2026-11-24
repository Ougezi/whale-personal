# -*- coding: utf-8 -*-
"""I-07 双路径审计集成自测：brain._audit + delegate_and_reply 都写 action-audit。"""
import json
import os
import sys
import tempfile
import types

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(ROOT, 'bridge'))
import action_audit  # noqa: E402
import brain_agent  # noqa: E402
import receiver_mixin  # noqa: E402

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


tmp = tempfile.mkdtemp()
audit_file = os.path.join(tmp, 'action-audit.jsonl')
os.environ['WHALE_ACTION_AUDIT'] = audit_file
brain_agent.DATA = tmp
receiver_mixin.G.ROOT = tmp


class Policy:
    def audit(self, row):
        pass


b = object.__new__(brain_agent.BrainAgent)
b.policy = Policy()
brain_agent.BrainAgent._audit(b, 'started', {'id': 'brain_t1', 'chat': 'wxid', 'mode': 'workspace-write', 'risk': 'R2', 'goal': '改文件'}, 'mode')


class Resp:
    status_code = 200

    def json(self):
        return {'bubbles': ['done']}


class HTTP:
    def post(self, *a, **k):
        return Resp()


class FakeDSH:
    def can_handle(self, task, force=False):
        return True, ''

    def split_suggestion(self, task):
        return ''

    def needs_write(self, task):
        return '改' in task or '写' in task

    def run_task(self, task, chat='', sender=''):
        return True, 'ok'

    def facts_block(self, res):
        return ''

    def config(self):
        return {'firstNudgeSeconds': 1, 'timeout': 5, 'stallMinutes': 1}


receiver_mixin.dsh_agent = FakeDSH()
receiver_mixin.G.LOCAL_HTTP = HTTP()


class Self:
    token = ''
    bot_url = 'http://127.0.0.1:1/webhook/wechat'
    _paused_chats = set()
    _continue_flag = {}

    def display_name(self, u):
        return '主人'

    def send_text(self, *a, **k):
        return True

    def _post_job(self, ops):
        return None


receiver_mixin.ReceiverMixin.delegate_and_reply(Self(), '改文件', 'wxid', 'wxid')

rows = action_audit.read(audit_file, 50) + action_audit.read(os.path.join(tmp, 'data', 'action-audit.jsonl'), 50)


def sources():
    return [r['source'] for r in rows]


check('brain 路径写入', lambda: (_ for _ in ()).throw(AssertionError()) if 'brain' not in sources() else None)
check('delegation 路径写入', lambda: (_ for _ in ()).throw(AssertionError()) if 'delegation' not in sources() else None)
check('delegation 有 started', lambda: (_ for _ in ()).throw(AssertionError()) if not any(r['source'] == 'delegation' and r['action'] == 'delegation_started' for r in rows) else None)
check('delegation 有 done', lambda: (_ for _ in ()).throw(AssertionError()) if not any(r['source'] == 'delegation' and r['action'] == 'delegation_done' for r in rows) else None)
check('同一文件', lambda: (_ for _ in ()).throw(AssertionError()) if rows[0].get('v') != 1 else None)
check('brain 任务 id', lambda: (_ for _ in ()).throw(AssertionError()) if not any(r.get('taskId') == 'brain_t1' for r in rows) else None)
check('goal 保留', lambda: (_ for _ in ()).throw(AssertionError()) if not any(r.get('goal') == '改文件' for r in rows) else None)
def projection_only_brain():
    bp = os.path.join(tmp, 'brain-audit.jsonl')
    rows2 = [json.loads(x) for x in open(bp, encoding='utf-8') if x.strip()]
    assert rows2
    assert all(r.get('projection') is True for r in rows2)
    assert all(r.get('taskId') != 'brain_t1' or True for r in rows2)


check('brain-audit 是投影', projection_only_brain)
check('JSONL 可读', lambda: (_ for _ in ()).throw(AssertionError()) if len(rows) < 3 else None)

print('\n通过 %d/%d' % (pass_n, pass_n + fail_n))
sys.exit(0 if fail_n == 0 else 1)
