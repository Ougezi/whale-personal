# -*- coding: utf-8 -*-
"""I-10 委托硬审批 + P0 策略复用自测。"""
import json
import os
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(ROOT, 'bridge'))
import delegation_approval as A  # noqa: E402
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
receiver_mixin.G.ROOT = tmp
os.environ['WHALE_ACTION_AUDIT'] = os.path.join(tmp, 'a.jsonl')


class Resp:
    status_code = 200

    def json(self):
        return {'bubbles': ['ok']}


class HTTP:
    def post(self, *a, **k):
        return Resp()


class DSH:
    runs = 0

    def can_handle(self, task, force=False):
        return True, ''

    def split_suggestion(self, task):
        return ''

    def needs_write(self, task):
        return '改' in task or '写' in task

    def pick_cwd(self, task):
        return r'D:\dsh\whale-personal\src\dist\whale-personal'

    def run_task(self, task, chat='', sender=''):
        DSH.runs += 1
        return True, 'ok'

    def facts_block(self, res):
        return ''

    def config(self):
        return {'firstNudgeSeconds': 1, 'timeout': 5, 'stallMinutes': 1}


receiver_mixin.dsh_agent = DSH()
receiver_mixin.G.LOCAL_HTTP = HTTP()


class Self:
    token = ''
    bot_url = 'http://127.0.0.1:1/webhook/wechat'
    _paused_chats = set()
    _continue_flag = {}
    _pending_tasks = {}

    def __init__(self):
        self.sent = []

    def display_name(self, u):
        return '主人'

    def send_text(self, text, *a, **k):
        self.sent.append(str(text))
        return True

    def _post_job(self, ops):
        return None


def empty_consume():
    A.clear('c0')
    assert A.consume('c0', '可以') is None


def r2_ask_reject():
    A.clear('c1'); A.ask('c1', '改文件', risk='R2')
    assert A.pending('c1')
    assert A.consume('c1', '不要')['action'] == 'reject'
    assert A.pending('c1') is None


def r2_approve():
    A.clear('c2'); A.ask('c2', '改文件', risk='R2')
    assert A.consume('c2', '可以')['action'] == 'approve'


def r3_two():
    A.clear('c3'); A.ask('c3', '删文件', risk='R3')
    assert A.consume('c3', '可以')['action'] == 'more'
    assert A.consume('c3', '可以')['action'] == 'approve'


def expired():
    A.clear('c4'); A.ask('c4', '改文件', risk='R2')
    A._PENDING['c4']['createdAt'] -= 400
    assert A.pending('c4') is None


def blocks_until_approved():
    A.clear('u1'); DSH.runs = 0
    s = Self()
    receiver_mixin.ReceiverMixin.delegate_and_reply(s, '改 D:\\dsh\\whale-personal\\src\\dist\\whale-personal\\i10.txt', 'u1', 'u1')
    assert DSH.runs == 0, DSH.runs
    assert A.pending('u1'), A.snapshot()
    assert any('动文件' in x for x in s.sent)


def approved_once():
    DSH.runs = 0
    s = Self()
    d = A.consume('u1', '可以')
    assert d['action'] == 'approve'
    receiver_mixin.ReceiverMixin.delegate_and_reply(s, d['item']['task'], 'u1', 'u1', force=True, approved=True)
    assert DSH.runs == 1, DSH.runs


def policy_blocked():
    A.clear('u2'); DSH.runs = 0
    s = Self()
    receiver_mixin.ReceiverMixin.delegate_and_reply(s, '改 C:\\Windows\\evil.txt', 'u2', 'u2')
    assert DSH.runs == 0
    assert any('边界' in x for x in s.sent)
    assert A.pending('u2') is None


def audit_requested():
    p = os.path.join(tmp, 'data', 'action-audit.jsonl')
    rows = [json.loads(x) for x in open(p, encoding='utf-8') if x.strip()]
    assert any(r.get('action') == 'approval_requested' for r in rows)


check('无 pending 不消费', empty_consume)
check('R2 拒绝', r2_ask_reject)
check('R2 一次确认', r2_approve)
check('R3 两次确认', r3_two)
check('过期', expired)
check('未确认不执行', blocks_until_approved)
check('确认后只跑一次', approved_once)
check('越界在审批前拦截', policy_blocked)
check('审批写审计', audit_requested)

print('\n通过 %d/%d' % (pass_n, pass_n + fail_n))
sys.exit(0 if fail_n == 0 else 1)
