# -*- coding: utf-8 -*-
"""I-24 A/B 报告 + 授权门槛。"""
import json, os, subprocess, sys, tempfile
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SCRIPT = os.path.join(ROOT, 'scripts', 'personal', '鲸鲸-主链ShadowAB.py')
PY = os.path.join(ROOT, 'dist', 'whale-personal', 'runtime', 'python', 'python.exe')
pass_n = fail_n = 0
def check(name, fn):
    global pass_n, fail_n
    try: fn(); pass_n += 1; print('  ✓ ' + name)
    except Exception as e: fail_n += 1; print('  ✗ ' + name + '  ' + str(e))
tmp = tempfile.mkdtemp(); shadow = os.path.join(tmp, 'shadow.jsonl'); approval = os.path.join(tmp, 'approval.json')
open(shadow, 'w', encoding='utf-8').write('\n'.join(json.dumps({'at': i, 'chatId': 'c', 'scope': 'wechat:default:default:private:u', 'affect': {'label': '日常'}, 'expression': {'literals': 1, 'markers': 0}, 'shadow': True}) for i in range(20)) + '\n')
def run(*args):
    p = subprocess.run([PY, SCRIPT] + list(args), capture_output=True, text=True, encoding='utf-8', errors='replace')
    return p.returncode, (p.stdout or '') + (p.stderr or '')
def enough():
    code, out = run('--shadow', shadow, '--json')
    data = json.loads(out[out.index('{'):])
    assert data['enough'] is True and data['samples'] == 20
check('报告 enough', enough)
def no_owner():
    code, out = run('--shadow', shadow, '--approve')
    assert code == 2 and '必须写' in out
check('无主人拒绝', no_owner)
def approve():
    code, out = run('--shadow', shadow, '--owner', 'ougezi', '--approve', '--approval', approval)
    assert code == 0 and os.path.exists(approval)
    d = json.load(open(approval, encoding='utf-8'))
    assert d['by'] == 'ougezi' and d['decision'] == 'approved-for-next-stage'
check('主人授权写记录', approve)
def insufficient():
    small = os.path.join(tmp, 'small.jsonl'); open(small, 'w', encoding='utf-8').write('{}\n')
    code, out = run('--shadow', small, '--owner', 'ougezi', '--approve', '--approval', os.path.join(tmp, 'no.json'))
    assert code == 3 and '样本不足' in out
check('样本不足拒绝', insufficient)
check('审批记录样本数', lambda: (_ for _ in ()).throw(AssertionError()) if json.load(open(approval, encoding='utf-8'))['samples'] != 20 else None)
check('审批不自动替换', lambda: (_ for _ in ()).throw(AssertionError()) if '自动替换' not in json.load(open(approval, encoding='utf-8'))['note'] else None)
print('\n通过 %d/%d' % (pass_n, pass_n + fail_n))
sys.exit(0 if fail_n == 0 else 1)
