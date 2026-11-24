# -*- coding: utf-8 -*-
r"""鲸鲸的 DSH 执行脑（bridge 侧）。

只做编排，不碰鲸鲸的人设/长期记忆：
- P1 只读：DSH headless --permission-mode read-only，不写文件。
- P2 可写：主人先确认，再用 workspace-write 跑；权限/审批在桥接层。
- P3 续跑：保存 DSH sessionId，用 --session-id 继续。
- P4 定时：每天固定时间跑只读任务。

触发词（主人私聊）：
  脑子：查一下 D:\...
  脑子写：修一下 ...
  脑子继续：...
  脑子状态
  脑子取消
  脑子定时：每天 09:00 汇总...
  脑子深查：两路只读侦察 + 一路汇总

设计约束：
- 只有主人私聊能触发；非主人一律不处理。
- 任务结果用自然中文发回，不把 tool 日志/traceback 发到微信。
- 任务卡落盘；重启后标记 interrupted，不自动重放有副作用的操作。
"""
import json
import os
import re
import subprocess
import threading
import time
import uuid

import dsh_agent
from brain_policy import BrainPolicy

ROOT = dsh_agent.ROOT
DATA = os.path.join(ROOT, 'data')
TASKS_FILE = os.path.join(DATA, 'brain-tasks.json')
PATCH_READONLY = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'brain-readonly.yml')
PATCH_WRITE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'brain-write.yml')
MAX_TASKS = 80
MAX_OUTPUT = 1400
MAX_PER_DAY = int(os.environ.get('WHALE_BRAIN_MAX_PER_DAY') or 20)
APPROVE_WORDS = {'可以', '行', '好', '批准', '执行', '同意', '嗯'}
REJECT_WORDS = {'不要', '不行', '取消', '拒绝', '算了', '不'}
WRITE_HINTS = ('改', '修', '写', '删', '安装', '部署', '重启', '替换', '创建', '生成文件', 'patch')
NET_RE = re.compile(r'curl|Invoke-WebRequest|Invoke-RestMethod|wget|Test-NetConnection|Resolve-DnsName|requests\.|https?\.get|fetch\(|socket\.', re.I)
CMD_RE = re.compile(r'^(?:/brain|脑子)(写|继续|状态|进度|取消|定时|深查|多查|多代理)?\s*[：:，,]\s*(.*)$', re.S)
SPACE_RE = re.compile(r'^(?:/brain|脑子)\s+(.+)$', re.S)
SCHED_RE = re.compile(r'^每天\s*(\d{1,2}:\d{2})\s*(.*)$', re.S)
ALLOWED_ROOTS = [os.path.abspath(x.strip()) for x in (os.environ.get('WHALE_BRAIN_ROOTS') or r'D:\dsh').split(';') if x.strip()]


def _now():
    return int(time.time() * 1000)


def _short(text, n=200):
    s = re.sub(r'\s+', ' ', str(text or '')).strip()
    return s[:n]


def _workspace_of(text):
    """从任务里抓一个存在的盘符路径；没有就用默认工作区。"""
    for m in re.finditer(r'([A-Za-z]:\\[^\s，,。；;]+)', str(text or '')):
        p = m.group(1).rstrip('\\/')
        if os.path.isdir(p):
            return os.path.abspath(p)
        parent = os.path.dirname(p)
        if os.path.isdir(parent):
            return os.path.abspath(parent)
    return os.path.abspath(dsh_agent.DEFAULT_CWD)


def _build_prompt(goal, mode, workspace):
    if mode == 'workspace-write':
        rule = ('这是可写任务。只在允许的工作区内改动；不要碰 data/、backup/；'
                '改动前先说明；改完必须验证（语法/测试/health 至少一种）。')
    else:
        rule = ('这是只读任务。不要写文件、不要删除、不要安装、不要改配置、不要 kill 进程、不要联网；'
                '只用读取/搜索/查看本地命令。')
    return (
        '你在给鲸鲸执行一个任务。鲸鲸是主人手机上的聊天角色，你是她背后的执行脑。\n'
        f'工作区：{workspace}\n'
        f'任务：{goal}\n'
        f'边界：{rule}\n'
        '输出要求：最后用简短、自然的中文汇报；先给结论，再给关键证据（路径/行号/命令）；'
        '不要贴大段日志、不要输出 JSON、不要用助手腔。'
    )


def _allowed_workspace(path):
    p = os.path.abspath(path)
    return any(p == r or p.startswith(r + os.sep) for r in ALLOWED_ROOTS)


def _denied_workspace(path):
    parts = os.path.abspath(path).lower().split(os.sep)
    return 'data' in parts or 'backup' in parts


def _denied_text(text):
    # 任务文本里出现的路径段也要拦，否则 cwd 在允许目录、目标却写进 data/
    return bool(re.search(r'(?:^|[\\/])(data|backup)(?:[\\/]|$)', str(text or ''), re.I))


class BrainAgent:
    def __init__(self, send, record=None, log=None):
        self.send = send                    # send(text, chat_username)
        self.record = record                # record(payload) 可选
        self.log = log or (lambda *a, **k: None)
        self._lock = threading.RLock()
        self._procs = {}
        self._state = {'version': 1, 'tasks': {}, 'sessions': {}, 'schedules': []}
        self.policy = BrainPolicy(DATA)
        self._load()
        self._stop = False

    # ------------------------------------------------------------------ 状态
    def _load(self):
        try:
            raw = json.load(open(TASKS_FILE, encoding='utf-8'))
            if isinstance(raw, dict) and isinstance(raw.get('tasks'), dict):
                self._state.update(raw)
        except Exception:
            pass
        changed = False
        for t in self._state.get('tasks', {}).values():
            if t.get('status') in ('running', 'queued', 'pending_approval'):
                # 重启后不自动重放有副作用的操作；只标记，等主人问起再说明
                if t.get('status') == 'pending_approval':
                    continue
                t['status'] = 'interrupted'
                t['finishedAt'] = _now()
                t['error'] = '进程重启，任务中断'
                changed = True
        if changed:
            self._save()

    def _save(self):
        try:
            os.makedirs(DATA, exist_ok=True)
            tasks = self._state.get('tasks', {})
            if len(tasks) > MAX_TASKS:
                for k in sorted(tasks, key=lambda x: tasks[x].get('createdAt', 0))[:-MAX_TASKS]:
                    tasks.pop(k, None)
            tmp = TASKS_FILE + '.tmp'
            with open(tmp, 'w', encoding='utf-8') as f:
                json.dump(self._state, f, ensure_ascii=False, indent=1)
            os.replace(tmp, TASKS_FILE)
        except Exception as e:
            self.log('brain 状态保存失败：', repr(e))

    def _task(self, task_id):
        return self._state.get('tasks', {}).get(task_id)

    def _latest(self, chat):
        items = [t for t in self._state.get('tasks', {}).values() if t.get('chat') == chat]
        return max(items, key=lambda t: t.get('createdAt', 0)) if items else None

    def _send(self, text, chat):
        try:
            return self.send(str(text or ''), chat)
        except Exception as e:
            self.log('brain 发送失败：', repr(e))
            return False

    def _daily_count(self):
        prefix = time.strftime('%Y-%m-%d')
        n = 0
        for t in self._state.get('tasks', {}).values():
            try:
                if time.strftime('%Y-%m-%d', time.localtime((t.get('createdAt') or 0) / 1000)) == prefix:
                    n += 1
            except Exception:
                pass
        return n

    def _quota_ok(self):
        return self._daily_count() < max(1, MAX_PER_DAY)

    def _audit(self, action, task, reason=''):
        try:
            self.policy.audit({
                'taskId': task.get('id') if task else '',
                'chat': task.get('chat') if task else '',
                'action': action,
                'mode': task.get('mode') if task else '',
                'risk': task.get('risk') if task else '',
                'goal': task.get('goal') if task else '',
                'reason': reason,
            })
        except Exception:
            pass

    # ------------------------------------------------------------------ 触发
    def handle_message(self, msg):
        """返回 True 表示这条消息已被执行脑接管，不再走普通聊天。"""
        username = str(msg.get('username') or '')
        sender = str(msg.get('sender_username') or username)
        # 主人 wxid 由 BrainMixin 注入；没有就不接管任何消息
        master = str(getattr(self, 'master', '') or '')
        if not master:
            return False
        if sender != master and username != master:
            return False
        text = str(msg.get('content') or '').strip()
        if not text:
            return False

        with self._lock:
            pending = [t for t in self._state['tasks'].values()
                       if t.get('chat') == username and t.get('status') == 'pending_approval']
        if pending:
            norm = text.replace(' ', '').replace('。', '').replace('！', '')
            if norm in APPROVE_WORDS:
                self.approve(username)
                return True
            if norm in REJECT_WORDS:
                self.reject(username)
                return True
            self._send('还在等你确认上一条：回复「可以」执行，或「不要」取消。', username)
            return True

        # 精确命令允许不带分隔符；普通任务必须带冒号/逗号或空格，避免「脑子有病」误触
        if text in ('脑子状态', '脑子进度'):
            self.status(username)
            return True
        if text == '脑子取消':
            self.cancel(username)
            return True
        m = CMD_RE.match(text)
        if not m:
            m = SPACE_RE.match(text)
            if not m:
                return False
            sub, body = '', (m.group(1) or '').strip()
        else:
            sub = (m.group(1) or '').strip()
            body = (m.group(2) or '').strip()

        if sub in ('状态', '进度'):
            self.status(username)
            return True
        if sub == '取消':
            self.cancel(username)
            return True
        if sub == '定时':
            self._schedule_command(username, body)
            return True
        if sub == '继续':
            if not body:
                self._send('要继续什么？写「脑子继续：接着查刚才那个」。', username)
                return True
            self._start(username, body, mode='read-only', resume=True)
            return True
        if sub in ('深查', '多查', '多代理'):
            if not body:
                self._send('多代理用法：脑子深查：查一下 D:\\...（两路只读侦察 + 汇总）', username)
                return True
            self._start_multi(username, body)
            return True
        # 脑子 / 脑子写
        if not body:
            self._send('执行脑用法：脑子：查一下 D:\\...；脑子写：修一下 ...；脑子深查：...；脑子状态；脑子取消。', username)
            return True
        # 只有显式「脑子写：」才进入写审批；「脑子：」永远是只读，避免“写”字误升级
        write_mode = sub == '写'
        if write_mode:
            self._ask_approval(username, body)
        else:
            self._start(username, body, mode='read-only')
        return True

    # ------------------------------------------------------------------ 审批
    def _ask_approval(self, chat, goal):
        with self._lock:
            running = [t for t in self._state['tasks'].values()
                       if t.get('chat') == chat and t.get('status') in ('running', 'queued')]
        if running:
            self._send('上一个任务还在跑，等它完再开写任务。', chat)
            return
        if not self._quota_ok():
            self._send('今天执行脑任务到上限了（%d 个），明天再试。' % MAX_PER_DAY, chat)
            return
        workspace = _workspace_of(goal)
        verdict = self.policy.check(goal, workspace, 'workspace-write')
        if not verdict.get('ok'):
            why = {'workspace_not_allowed': '工作区不在允许范围',
                   'denied_workspace': '不能碰 data/backup',
                   'denied_path': '任务路径里不能有 data/backup',
                   'credential_path': '不能碰凭据/配置文件'}.get(verdict.get('reason'), '被策略拒绝')
            self._send('这个任务被拦了：' + why + '。', chat)
            return
        risk = verdict.get('risk') or 'R2'
        task = self._new_task(chat, goal, 'workspace-write', workspace, risk=risk)
        task['status'] = 'pending_approval'
        self._save()
        self._audit('approval_requested', task, 'risk=' + risk)
        self._send(
            '这个要动文件/跑命令，我需要你确认。\n'
            f'任务：{_short(goal, 100)}\n'
            f'工作区：{workspace}\n'
            f'风险：{risk}（{"需二次确认" if risk == "R3" else "可恢复，但会改工作区"}）\n'
            '回滚：改前备份/失败还原，只动工作区。\n'
            '回复「可以」执行，「不要」取消；5 分钟不回复默认取消。', chat)

    def approve(self, chat):
        with self._lock:
            task = next((t for t in self._state['tasks'].values()
                         if t.get('chat') == chat and t.get('status') == 'pending_approval'), None)
        if not task:
            self._send('没有待确认的任务。', chat)
            return
        self._audit('approved', task, 'owner')
        self._send('好，我开始改；会先备份/只动工作区，弄完给你证据。', chat)
        self._run(task)

    def reject(self, chat):
        with self._lock:
            task = next((t for t in self._state['tasks'].values()
                         if t.get('chat') == chat and t.get('status') == 'pending_approval'), None)
            if task:
                task['status'] = 'cancelled'
                task['finishedAt'] = _now()
                task['error'] = '主人取消'
                self._audit('rejected', task, 'owner')
        self._save()
        self._send('好，那先不动。', chat)

    def _expire_pending(self, now=None):
        now = _now() if now is None else int(now)
        with self._lock:
            changed = []
            for t in self._state['tasks'].values():
                if t.get('status') == 'pending_approval' and now - t.get('createdAt', 0) > 300000:
                    t['status'] = 'cancelled'
                    t['finishedAt'] = now
                    t['error'] = '审批超时'
                    changed.append(t)
                    self._audit('cancelled', t, 'approval_timeout')
        if changed:
            self._save()
            for t in changed:
                self._send('等太久没确认，我先不动了。', t['chat'])
        return len(changed)

    def _approval_timeout_loop(self):
        while not self._stop:
            time.sleep(10)
            try:
                self._expire_pending()
            except Exception as e:
                self.log('审批超时检查失败：', repr(e))

    # ------------------------------------------------------------------ 任务
    def _new_task(self, chat, goal, mode, workspace, risk='R2'):
        task = {
            'id': 'brain_' + uuid.uuid4().hex[:10],
            'chat': chat,
            'goal': goal,
            'mode': mode,
            'workspace': workspace,
            'risk': risk,
            'status': 'queued',
            'createdAt': _now(),
            'sessionId': '',
            'output': '',
            'error': '',
        }
        with self._lock:
            self._state['tasks'][task['id']] = task
        self._audit('created', task, 'mode=' + mode)
        return task

    def _start(self, chat, goal, mode='read-only', resume=False):
        with self._lock:
            running = [t for t in self._state['tasks'].values()
                       if t.get('chat') == chat and t.get('status') in ('running', 'queued')]
        if running:
            self._send('上一个任务还在跑，等它完再开新的。', chat)
            return
        if not self._quota_ok():
            self._send('今天执行脑任务到上限了（%d 个），明天再试。' % MAX_PER_DAY, chat)
            return
        with self._lock:
            all_running = [t for t in self._state['tasks'].values()
                           if t.get('status') in ('running', 'queued')]
        if len(all_running) >= 2:
            self._send('执行脑手上还有 2 个任务，等一个跑完再开。', chat)
            return
        workspace = _workspace_of(goal)
        verdict = self.policy.check(goal, workspace, mode)
        if not verdict.get('ok'):
            why = {'workspace_not_allowed': '工作区不在允许范围',
                   'denied_workspace': '不能碰 data/backup',
                   'denied_path': '任务路径里不能有 data/backup',
                   'credential_path': '不能碰凭据/配置文件'}.get(verdict.get('reason'), '被策略拒绝')
            self._send('这个任务被拦了：' + why + '。', chat)
            return
        task = self._new_task(chat, goal, mode, workspace, risk=verdict.get('risk') or 'R0')
        if resume:
            with self._lock:
                sess = self._state.get('sessions', {}).get(chat) or {}
            if sess.get('sessionId'):
                task['sessionId'] = sess['sessionId']
        self._run(task)

    def _collect_once(self, prompt, workspace, timeout=150):
        """同步跑一次只读 DSH，返回 final 文本；供多代理侦察/汇总使用。"""
        key = dsh_agent._api_key()
        if not key:
            return '（没有可用 API key）'
        cmd = [dsh_agent.EXE, dsh_agent.BIN, '--profile', 'headless',
               '--patch', PATCH_READONLY, '--json',
               '--permission-mode', 'read-only', '--approval-policy', 'never', prompt]
        env = dict(os.environ)
        env['DEEPSEEK_API_KEY'] = key
        flags = getattr(subprocess, 'CREATE_NEW_PROCESS_GROUP', 0)
        try:
            p = subprocess.Popen(cmd, cwd=workspace, env=env, stdout=subprocess.PIPE,
                                 stderr=subprocess.PIPE, text=True, encoding='utf-8',
                                 errors='replace', creationflags=flags)
        except Exception as e:
            return '（启动失败：%s）' % _short(repr(e), 80)
        try:
            out, err = p.communicate(timeout=timeout)
        except subprocess.TimeoutExpired:
            try:
                subprocess.run(['taskkill', '/PID', str(p.pid), '/T', '/F'],
                               capture_output=True, timeout=15)
            except Exception:
                try: p.kill()
                except Exception: pass
            return '（超时）'
        text = ''
        error = ''
        for line in (out or '').splitlines():
            try:
                ev = json.loads(line)
            except Exception:
                continue
            if ev.get('type') == 'text':
                text += str(ev.get('text') or '')
            elif ev.get('type') == 'final':
                text = str(ev.get('text') or text)
                reason = ev.get('reason') or {}
                if reason.get('kind') == 'error':
                    error = str((reason.get('error') or {}).get('message') or '')[:200]
        return (text.strip() or (('（失败：%s）' % error) if error else '（没有结果）'))[:1800]

    def _start_multi(self, chat, goal):
        with self._lock:
            running = [t for t in self._state['tasks'].values()
                       if t.get('chat') == chat and t.get('status') in ('running', 'queued')]
            all_running = [t for t in self._state['tasks'].values()
                           if t.get('status') in ('running', 'queued')]
        if running or len(all_running) >= 2:
            self._send('执行脑还在忙，等一个跑完再开多代理。', chat)
            return
        if not self._quota_ok():
            self._send('今天执行脑任务到上限了（%d 个），明天再试。' % MAX_PER_DAY, chat)
            return
        workspace = _workspace_of(goal)
        verdict = self.policy.check(goal, workspace, 'read-only')
        if not verdict.get('ok'):
            self._send('这个任务被拦了：工作区/路径不符合策略。', chat)
            return
        task = self._new_task(chat, goal, 'multi-readonly', workspace, risk='R0')
        task['status'] = 'running'
        task['startedAt'] = _now()
        self._save()
        self._audit('started', task, 'mode=multi-readonly')
        self._send('我拆两路只读查一下，最后汇总给你。', chat)
        threading.Thread(target=self._multi_worker, args=(task,), daemon=True,
                         name='brain-multi-' + task['id']).start()

    def _multi_worker(self, task):
        if task.get('status') == 'cancelled':
            return
        goal = task['goal']
        ws = task['workspace']
        pa = ('只读侦察 A（项目结构/入口/配置/依赖）：' + goal +
              '\n只列 5-8 条事实 + 证据路径，不要建议、不要写文件、不要联网。')
        pb = ('只读侦察 B（日志/报错/测试/最近改动）：' + goal +
              '\n只列 5-8 条事实 + 证据路径，不要建议、不要写文件、不要联网。')
        notes = {}
        def scout(name, prompt):
            notes[name] = self._collect_once(prompt, ws, 150)
        ts = [threading.Thread(target=scout, args=('A', pa), daemon=True),
              threading.Thread(target=scout, args=('B', pb), daemon=True)]
        for t in ts: t.start()
        for t in ts: t.join()
        if task.get('status') == 'cancelled':
            return
        self._send('两路查完了，我汇总一下。', task['chat'])
        manager = ('你是鲸鲸的执行脑。下面是两路只读侦察报告。\n'
                   '请合并成一份简短结论：先给结论，再给关键证据；不要贴日志、不要写文件。\n\n'
                   '侦察 A：\n' + notes.get('A', '（无）') +
                   '\n\n侦察 B：\n' + notes.get('B', '（无）'))
        final = self._collect_once(manager, ws, 150)
        if task.get('status') == 'cancelled':
            return
        if not final or final.startswith('（'):
            final = '两路侦察：\nA：%s\nB：%s' % (notes.get('A', '（无）')[:500], notes.get('B', '（无）')[:500])
        task['status'] = 'done'
        task['finishedAt'] = _now()
        task['output'] = final[:MAX_OUTPUT]
        task['scouts'] = {k: v[:800] for k, v in notes.items()}
        self._save()
        self._audit('done', task, 'multi chars=%d' % len(final))
        self._send(final[:MAX_OUTPUT], task['chat'])
        try:
            if self.record:
                self.record({'chat': task['chat'], 'taskId': task['id'], 'goal': goal,
                             'status': 'done', 'result': final[:800], 'mode': 'multi-readonly'})
        except Exception as e:
            self.log('brain 多代理入记忆失败：', repr(e))

    def _run(self, task):
        key = dsh_agent._api_key()
        if not key:
            task['status'] = 'failed'
            task['error'] = '没有可用 API key'
            self._save()
            self._send('执行端没配好 key，跑不了。', task['chat'])
            return
        asar = os.path.join(os.path.dirname(dsh_agent.EXE), 'resources', 'app.asar')
        if not (os.path.isfile(dsh_agent.EXE) and os.path.isfile(asar)):
            task['status'] = 'failed'
            task['error'] = 'DSH 可执行文件不存在'
            self._save()
            self._send('我这边没找到执行端，做不了。', task['chat'])
            return
        task['status'] = 'running'
        task['startedAt'] = _now()
        self._save()
        mode = task.get('mode') or 'read-only'
        self._audit('started', task, 'mode=' + mode)
        prompt = _build_prompt(task['goal'], mode, task['workspace'])
        cmd = [dsh_agent.EXE, dsh_agent.BIN, '--profile', 'headless']
        if mode == 'read-only':
            cmd += ['--patch', PATCH_READONLY]
        elif mode == 'workspace-write':
            cmd += ['--patch', PATCH_WRITE]
        cmd += ['--json', '--permission-mode', mode, '--approval-policy', 'never']
        if task.get('sessionId'):
            cmd += ['--session-id', task['sessionId']]
        cmd.append(prompt)
        env = dict(os.environ)
        env['DEEPSEEK_API_KEY'] = key
        flags = 0
        try:
            flags = subprocess.CREATE_NEW_PROCESS_GROUP
        except Exception:
            flags = 0
        try:
            proc = subprocess.Popen(
                cmd, cwd=task['workspace'], env=env, stdout=subprocess.PIPE,
                stderr=subprocess.PIPE, text=True, encoding='utf-8', errors='replace',
                creationflags=flags)
        except Exception as e:
            task['status'] = 'failed'
            task['error'] = repr(e)
            self._save()
            self._send('执行端没启动起来（不影响聊天）。', task['chat'])
            return
        self._procs[task['id']] = proc
        self.log('brain 启动：%s mode=%s cwd=%s' % (task['id'], mode, task['workspace']))
        threading.Thread(target=self._reader, args=(task, proc), daemon=True, name='brain-' + task['id']).start()
        threading.Thread(target=self._watchdog, args=(task, proc), daemon=True, name='brain-wd-' + task['id']).start()
        if mode == 'workspace-write':
            self._send('在改，弄完给你结果和证据。', task['chat'])
        else:
            self._send('在看了，稍等。', task['chat'])

    def _watchdog(self, task, proc):
        started = time.time()
        warned = False
        while proc.poll() is None:
            time.sleep(5)
            if time.time() - started > 240:
                try:
                    subprocess.run(['taskkill', '/PID', str(proc.pid), '/T', '/F'],
                                   capture_output=True, timeout=15)
                except Exception:
                    try: proc.kill()
                    except Exception: pass
                if task.get('status') == 'running':
                    task['status'] = 'timeout'
                    task['error'] = '执行超时（4 分钟）'
                    task['finishedAt'] = _now()
                    self._save()
                    self._audit('timeout', task, '4min')
                    self._send('这个任务有点久，我先停了。可以拆小一点再试。', task['chat'])
                return
            if not warned and time.time() - started > 45:
                warned = True
                self._send('还在弄，稍等。', task['chat'])

    def _tool_guard(self, task, ev):
        """P2 默认不允许联网：web 工具已 patch 掉，shell 网络命令在这里拦。"""
        if task.get('mode') != 'workspace-write':
            return True
        if os.environ.get('WHALE_BRAIN_ALLOW_NETWORK') == '1' or task.get('network'):
            return True
        if ev.get('type') != 'tool_call':
            return True
        tool = str(ev.get('tool') or '')
        inp = json.dumps(ev.get('input') or {}, ensure_ascii=False)
        if NET_RE.search(inp) or tool in ('web_fetch', 'web_search'):
            task['error'] = 'network_blocked（任务尝试联网，已拦截）'
            task['status'] = 'failed'
            task['finishedAt'] = _now()
            self._save()
            self._audit('blocked_network', task, tool)
            return False
        return True

    def _drain_stderr(self, proc):
        try:
            proc.stderr.read()
        except Exception:
            pass

    def _reader(self, task, proc):
        final_text = ''
        final_error = ''
        got_final = False
        threading.Thread(target=self._drain_stderr, args=(proc,), daemon=True,
                         name='brain-err-' + task['id']).start()
        try:
            for line in proc.stdout:
                line = line.strip()
                if not line:
                    continue
                try:
                    ev = json.loads(line)
                except Exception:
                    continue
                typ = ev.get('type')
                if typ == 'session' and ev.get('sessionId'):
                    task['sessionId'] = ev['sessionId']
                    with self._lock:
                        self._state.setdefault('sessions', {})[task['chat']] = {
                            'sessionId': ev['sessionId'], 'workspace': task['workspace']}
                    self._save()
                elif typ == 'tool_call':
                    task['toolCalls'] = int(task.get('toolCalls', 0)) + 1
                    if not self._tool_guard(task, ev):
                        try:
                            subprocess.run(['taskkill', '/PID', str(proc.pid), '/T', '/F'],
                                           capture_output=True, timeout=15)
                        except Exception:
                            try: proc.kill()
                            except Exception: pass
                        break
                elif typ == 'text':
                    final_text += str(ev.get('text') or '')
                elif typ == 'final':
                    final_text = str(ev.get('text') or final_text)
                    reason = (ev.get('reason') or {})
                    if reason.get('kind') == 'error':
                        final_error = _short((reason.get('error') or {}).get('message') or '未知错误', 200)
                    got_final = True
                    break
        except Exception as e:
            final_error = _short(repr(e), 160)
        finally:
            # 关键：不再先 stderr.read()（会阻塞），最多等 8 秒，然后收掉进程
            try:
                proc.wait(timeout=8)
            except subprocess.TimeoutExpired:
                try:
                    proc.kill()
                except Exception:
                    pass
                try:
                    proc.wait(timeout=5)
                except Exception:
                    pass
            self._procs.pop(task['id'], None)

        if task.get('status') == 'cancelled':
            self._save()
            return
        error = final_error or task.get('error')
        if error:
            task['status'] = 'failed'
            task['finishedAt'] = _now()
            task['error'] = error
            self._save()
            self._audit('failed', task, error)
            self._send('这边没跑成：' + _short(error, 120), task['chat'])
            return
        text = final_text.strip()
        if not text:
            text = '任务跑完了，但没拿到可读结果。'
        task['status'] = 'done'
        task['finishedAt'] = _now()
        task['output'] = text[:MAX_OUTPUT]
        task['final'] = bool(got_final)
        self._save()
        self._audit('done', task, 'chars=%d' % len(text))
        self._send(text[:MAX_OUTPUT], task['chat'])
        try:
            if self.record:
                self.record({'chat': task['chat'], 'taskId': task['id'], 'goal': task['goal'],
                             'status': 'done', 'result': text[:800], 'mode': task['mode']})
        except Exception as e:
            self.log('brain 结果入记忆失败：', repr(e))
        self.log('brain 完成：%s 字数=%d' % (task['id'], len(text)))

    # ------------------------------------------------------------------ 查询/取消
    def status(self, chat):
        with self._lock:
            t = self._latest(chat)
        if not t:
            self._send('还没有执行脑任务。用法：脑子：查一下 D:\\...', chat)
            return
        label = {'running': '在跑', 'pending_approval': '等你确认', 'done': '已完成',
                 'failed': '失败', 'cancelled': '已取消', 'interrupted': '中断', 'timeout': '超时'}.get(t.get('status'), t.get('status'))
        self._send(f'最近任务：{label}；{_short(t.get("goal"), 80)}', chat)

    def cancel(self, chat):
        with self._lock:
            t = self._latest(chat)
        if not t:
            self._send('没有可取消的任务。', chat)
            return
        proc = self._procs.get(t['id'])
        if proc:
            try:
                subprocess.run(['taskkill', '/PID', str(proc.pid), '/T', '/F'],
                               capture_output=True, timeout=15)
            except Exception:
                try: proc.kill()
                except Exception: pass
        t['status'] = 'cancelled'
        t['finishedAt'] = _now()
        self._save()
        self._audit('cancelled', t, 'owner')
        self._send('好，停了。', chat)

    # ------------------------------------------------------------------ 定时
    def _schedule_command(self, chat, body):
        if body in ('列表', 'list', ''):
            with self._lock:
                items = [s for s in self._state.get('schedules', []) if s.get('chat') == chat]
            if not items:
                self._send('还没有定时任务。用法：脑子定时：每天 09:00 汇总项目状态。', chat)
            else:
                self._send('定时任务：' + '；'.join(f'{s["at"]} {_short(s["goal"], 30)}' for s in items), chat)
            return
        m = SCHED_RE.match(body)
        if not m:
            self._send('定时格式：脑子定时：每天 09:00 汇总项目状态。', chat)
            return
        at, goal = m.group(1), m.group(2).strip()
        if not goal:
            self._send('定时任务要写做什么，例如：脑子定时：每天 09:00 汇总项目状态。', chat)
            return
        with self._lock:
            self._state.setdefault('schedules', []).append({
                'id': 'sch_' + uuid.uuid4().hex[:8], 'chat': chat,
                'at': at, 'goal': goal, 'lastDay': ''})
        self._save()
        self._send(f'好，每天 {at} 给你跑一次：{_short(goal, 60)}', chat)

    def watch_schedules(self):
        while not self._stop:
            time.sleep(30)
            try:
                now = time.localtime()
                hm = '%02d:%02d' % (now.tm_hour, now.tm_min)
                day = time.strftime('%Y-%m-%d', now)
                with self._lock:
                    if now.tm_hour >= 23 or now.tm_hour < 8:
                        continue
                    due = [s for s in self._state.get('schedules', [])
                           if s.get('at') == hm and s.get('lastDay') != day]
                for s in due:
                    s['lastDay'] = day
                    self._save()
                    self._start(s['chat'], s['goal'], mode='read-only')
            except Exception as e:
                self.log('brain 定时检查失败：', repr(e))

    def start_watch(self):
        threading.Thread(target=self._approval_timeout_loop, daemon=True, name='brain-approval').start()
        threading.Thread(target=self.watch_schedules, daemon=True, name='brain-schedule').start()

    def stop(self):
        self._stop = True
        for proc in list(self._procs.values()):
            try: proc.kill()
            except Exception: pass
