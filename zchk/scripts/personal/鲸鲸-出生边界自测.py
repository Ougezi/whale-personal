# -*- coding: utf-8 -*-
"""B3-02 策略/路径/网络自测：越界、data/backup、凭据、联网、审计脱敏。"""
import json
import os
import shutil
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(ROOT, 'bridge'))
from brain_policy import BrainPolicy  # noqa: E402

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


base = tempfile.mkdtemp(prefix='whale-policy-')
root = os.path.join(base, 'ws')
os.makedirs(os.path.join(root, 'src'), exist_ok=True)
os.makedirs(os.path.join(root, 'data'), exist_ok=True)
os.makedirs(os.path.join(root, 'backup'), exist_ok=True)
data_dir = os.path.join(base, 'state')
policy = BrainPolicy(data_dir, roots=[root])


def raises(fn):
    try:
        fn()
    except Exception:
        return
    raise AssertionError('did not raise')


def expect(cond):
    if not cond:
        raise AssertionError('condition false')


check('工作区内放行', lambda: expect(policy.workspace_allowed(os.path.join(root, 'src', 'a.py'))))
check('工作区外拒绝', lambda: expect(not policy.workspace_allowed(r'C:\Windows\win.ini')))
check('越界读拒绝', lambda: expect(not policy.check_action('读取 C:\\\\Windows\\\\win.ini', r'C:\Windows', 'read-only')['ok']))
check('越界写拒绝', lambda: expect(not policy.check_action('改文件', r'C:\Windows', 'write')['ok']))
check('data 段拒绝', lambda: expect(policy.workspace_denied(os.path.join(root, 'data', 'x'))))
check('backup 段拒绝', lambda: expect(policy.workspace_denied(os.path.join(root, 'backup', 'x'))))
check('凭据路径拒绝', lambda: expect(bool(policy.text_denied(r'D:\dsh\settings.json'))))
check('R0 只读', lambda: expect(policy.check('看看日志', root, 'read-only')['risk'] == 'R0'))
check('R2 写', lambda: expect(policy.check('改配置', root, 'write')['risk'] == 'R2'))
check('R3 删除', lambda: expect(policy.check('删除旧文件', root, 'write')['risk'] == 'R3'))
check('联网拦截', lambda: expect(policy.check_action('curl https://evil.test', root, 'write')['reason'] == 'network_blocked'))
check('联网显式放行', lambda: expect(policy.check_action('curl https://example.com', root, 'write', allow_network=True)['ok']))
FAKE_KEY = 'sk' + '-' + 'ABCD' + 'EFGH' + '12345678'
check('审计脱敏', lambda: (policy.audit({'goal': 'key ' + FAKE_KEY, 'reason': 'x'}), expect('sk' + '-' + 'ABCD' not in open(policy.audit_file, encoding='utf-8').read())))

print('\n通过 %d/%d' % (pass_n, pass_n + fail_n))
shutil.rmtree(base, ignore_errors=True)
sys.exit(0 if fail_n == 0 else 1)
