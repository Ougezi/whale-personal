# -*- coding: utf-8 -*-
"""出生技能 · Command Bus（B5-01）。

命令是枚举，不是自由文本：
  say / ask / confirm / act / stop / remind / remember / forget

硬约束：
  - target 必须在白名单；错误接收人 0；
  - 每回合最多一条 say；
  - id 幂等；重复 0；
  - act 的 R2/R3 必须 approved；
  - 所有入队写审计（可注入）。
"""
import time

COMMANDS = {'say', 'ask', 'confirm', 'act', 'stop', 'remind', 'remember', 'forget'}
RISKS = {'R0', 'R1', 'R2', 'R3'}
SAY_ONCE = {'say'}


class CommandError(Exception):
    pass


class CommandBus:
    def __init__(self, allowed_targets=None, audit=None):
        self.allowed_targets = set(allowed_targets or [])
        self.audit = audit
        self.outbox = []
        self.seen = set()
        self.say_turns = set()
        self.history = []

    def _log(self, event):
        row = dict(event)
        row['at'] = int(time.time() * 1000)
        self.history.append(row)
        if callable(self.audit):
            try:
                self.audit(row)
            except Exception:
                pass

    def dispatch(self, command, *, target, text='', turn='', cid='', risk='R0',
                 approved=False, payload=None):
        cmd = str(command or '')
        if cmd not in COMMANDS:
            raise CommandError('unknown command: ' + cmd)
        tgt = str(target or '')
        if not tgt:
            raise CommandError('target required')
        if self.allowed_targets and tgt not in self.allowed_targets:
            raise CommandError('target not allowed: ' + tgt)
        if risk not in RISKS:
            raise CommandError('risk invalid')
        if cmd == 'act' and risk in ('R2', 'R3') and not approved:
            raise CommandError('approval required for ' + risk)
        if cmd in SAY_ONCE:
            key = str(turn or '')
            if key and key in self.say_turns:
                raise CommandError('say already sent this turn')
        if cid:
            if cid in self.seen:
                return {'ok': True, 'duplicate': True, 'command': cmd, 'target': tgt, 'cid': cid}
            self.seen.add(cid)
        entry = {
            'command': cmd, 'target': tgt, 'text': str(text or '')[:2000],
            'turn': str(turn or ''), 'cid': str(cid or ''), 'risk': risk,
            'payload': payload or {},
        }
        self.outbox.append(entry)
        if cmd in SAY_ONCE and entry['turn']:
            self.say_turns.add(entry['turn'])
        self._log({'action': 'enqueue', **entry})
        return {'ok': True, 'duplicate': False, **entry}

    def take(self):
        items = list(self.outbox)
        self.outbox = []
        return items

    def snapshot(self):
        return {'outbox': list(self.outbox), 'seen': len(self.seen), 'history': list(self.history)}
