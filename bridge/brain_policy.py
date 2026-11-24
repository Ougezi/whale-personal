# -*- coding: utf-8 -*-
"""执行脑策略/审计：工作区、凭据、风险分级、审计日志。

只做判断和记录，不碰 DSH 进程/微信。
"""
import json
import os
import re
import threading
import time

ROOT = os.environ.get('WHALE_BRAIN_ROOT') or r'D:\dsh'
DEFAULT_ROOTS = [os.path.abspath(x.strip()) for x in (os.environ.get('WHALE_BRAIN_ROOTS') or ROOT).split(';') if x.strip()]
DENY_SEGMENTS = {'data', 'backup'}
CRED_RE = re.compile(r'(?:^|[\\/])(?:settings|config|credentials?)\.json\b|(?:^|[\\/])\.env\b|id_rsa|api[_-]?key', re.I)
R3_RE = re.compile(r'删除|删掉|清空|kill|结束进程|安装|卸载|管理员|注册表|git\s+push|外发|上传|发送.*(?:密码|密钥|token)', re.I)
SECRET_RE = re.compile(r'sk-[A-Za-z0-9]{8,}')


class BrainPolicy:
    def __init__(self, data_dir, roots=None):
        self.data_dir = data_dir
        self.roots = [os.path.abspath(x) for x in (roots or DEFAULT_ROOTS)]
        self.audit_file = os.path.join(data_dir, 'brain-audit.jsonl')
        self._lock = threading.RLock()

    def workspace_allowed(self, path):
        p = os.path.abspath(str(path or ''))
        return any(p == r or p.startswith(r + os.sep) for r in self.roots)

    def workspace_denied(self, path):
        parts = os.path.abspath(str(path or '')).lower().split(os.sep)
        return any(x in DENY_SEGMENTS for x in parts)

    def text_denied(self, text):
        s = str(text or '')
        # 路径段 data/backup
        if re.search(r'(?:^|[\\/])(?:data|backup)(?:[\\/]|$)', s, re.I):
            return 'denied_path'
        if CRED_RE.search(s):
            return 'credential_path'
        return ''

    def risk_of(self, goal, mode):
        if mode == 'read-only':
            return 'R0'
        if R3_RE.search(str(goal or '')):
            return 'R3'
        return 'R2'

    def check(self, goal, workspace, mode):
        if not self.workspace_allowed(workspace):
            return {'ok': False, 'reason': 'workspace_not_allowed', 'risk': 'R0'}
        if self.workspace_denied(workspace):
            return {'ok': False, 'reason': 'denied_workspace', 'risk': 'R0'}
        why = self.text_denied(goal)
        if why:
            return {'ok': False, 'reason': why, 'risk': 'R0'}
        return {'ok': True, 'reason': 'ok', 'risk': self.risk_of(goal, mode)}

    def audit(self, event):
        """追加审计；失败不影响任务。不写密钥/全文。"""
        try:
            row = dict(event or {})
            row['at'] = int(time.time() * 1000)
            for k in ('goal', 'reason', 'result'):
                if k in row:
                    row[k] = SECRET_RE.sub('sk-***', str(row[k]))[:180]
            line = json.dumps(row, ensure_ascii=False)
            with self._lock:
                os.makedirs(self.data_dir, exist_ok=True)
                with open(self.audit_file, 'a', encoding='utf-8') as f:
                    f.write(line + '\n')
                # 简单保留最近 2000 行
                try:
                    if os.path.getsize(self.audit_file) > 2 * 1024 * 1024:
                        with open(self.audit_file, encoding='utf-8') as f:
                            rows = f.read().splitlines()[-2000:]
                        with open(self.audit_file, 'w', encoding='utf-8') as f:
                            f.write('\n'.join(rows) + '\n')
                except Exception:
                    pass
        except Exception:
            pass
