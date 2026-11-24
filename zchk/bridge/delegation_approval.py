# -*- coding: utf-8 -*-
"""委托链硬审批（I-10）。

写任务不再“模型问一句就执行”，而是在 bridge 里挂起：
  - R2：主人一次确认；
  - R3：主人两次确认；
  - 5 分钟过期；拒绝即取消；
  - 只对当前 chat 生效。
"""
import time

TTL_SEC = 300
APPROVE = {'可以', '行', '好', '批准', '执行', '同意', '嗯', '确认'}
REJECT = {'不要', '不行', '取消', '拒绝', '算了', '不'}
_PENDING = {}


def _norm(text):
    return str(text or '').replace(' ', '').replace('。', '').replace('！', '').strip()


def required(risk):
    return 2 if str(risk or '').upper() == 'R3' else 1


def ask(chat, task, sender='', workspace='', risk='R2', send=None):
    now = time.time()
    _PENDING[str(chat)] = {'task': task, 'sender': sender, 'workspace': workspace,
                           'risk': risk, 'createdAt': now, 'approvals': []}
    if callable(send):
        need = required(risk)
        send('这个委托要动文件，我先不动。\n任务：%s\n工作区：%s\n风险：%s（需 %d 次确认）\n'
             '回复「可以」执行，「不要」取消；5 分钟后自动失效。'
             % (str(task)[:100], workspace, risk, need))
    return _PENDING[str(chat)]


def pending(chat):
    item = _PENDING.get(str(chat))
    if not item:
        return None
    if time.time() - item['createdAt'] > TTL_SEC:
        _PENDING.pop(str(chat), None)
        return None
    return item


def consume(chat, text):
    item = pending(chat)
    if not item:
        return None
    norm = _norm(text)
    if norm in REJECT:
        _PENDING.pop(str(chat), None)
        return {'action': 'reject', 'item': item}
    if norm in APPROVE:
        item['approvals'].append(norm)
        need = required(item['risk'])
        if len(item['approvals']) >= need:
            _PENDING.pop(str(chat), None)
            return {'action': 'approve', 'item': item}
        return {'action': 'more', 'item': item, 'remaining': need - len(item['approvals'])}
    return None


def clear(chat):
    _PENDING.pop(str(chat), None)


def snapshot():
    return {k: {'task': v['task'], 'risk': v['risk'], 'approvals': list(v['approvals'])}
            for k, v in _PENDING.items()}
