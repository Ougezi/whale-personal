# -*- coding: utf-8 -*-
"""一键回归：源码测试 + dist E2E + 矩阵 + 同步 + selfcheck。

默认只跑只读/可重复测试；--real 才跑真实 DSH 动作（会写审计/测试文件）。
"""
import argparse
import json
import os
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
DIST = os.path.join(ROOT, 'dist', 'whale-personal')
NODE = os.path.join(DIST, 'runtime', 'node.exe')
PY = os.path.join(DIST, 'runtime', 'python', 'python.exe')
ENV = dict(os.environ, PYTHONIOENCODING='utf-8')

CASES = [
    ('结构治理', 'node', 'scripts/personal/鲸鲸-主链结构治理自测.js', {}),
    ('检索 core', 'node', 'scripts/personal/鲸鲸-主链检索Core自测.js', {}),
    ('Job 账本', 'node', 'scripts/personal/鲸鲸-主链Job账本自测.js', {}),
    ('回执账本', 'node', 'scripts/personal/鲸鲸-主链回执账本自测.js', {}),
    ('回执轮转', 'py', 'scripts/personal/鲸鲸-主链回执轮转自测.py', {}),
    ('承诺账本', 'node', 'scripts/personal/鲸鲸-主链承诺账本自测.js', {}),
    ('动作目录', 'node', 'scripts/personal/鲸鲸-主链动作目录自测.js', {}),
    ('委托审批', 'py', 'scripts/personal/鲸鲸-主链委托审批自测.py', {}),
    ('动作审计', 'py', 'scripts/personal/鲸鲸-主链动作审计自测.py', {}),
    ('双路径审计', 'py', 'scripts/personal/鲸鲸-主链动作审计双路径自测.py', {}),
    ('接入矩阵', 'py', 'scripts/personal/鲸鲸-主链接入矩阵自测.py', {}),
    ('dist 同步', 'py', 'scripts/personal/鲸鲸-主链dist同步自测.py', {}),
    ('kernel', 'node', 'scripts/personal/鲸鲸-内核自测.js', {'WHALE_ROOT': ROOT}),
    ('bridge', 'py', 'scripts/personal/鲸鲸-自测.py', {'WHALE_ROOT': DIST}),
    ('执行脑', 'py', 'scripts/personal/鲸鲸-执行脑自测.py', {'WHALE_ROOT': DIST}),
    ('出生技能', 'py', 'scripts/personal/鲸鲸-出生技能自测.py', {}),
]


def run(cmd, env_extra=None):
    e = dict(ENV)
    if env_extra:
        e.update(env_extra)
    p = subprocess.run(cmd, cwd=ROOT, env=e, capture_output=True, text=True,
                       encoding='utf-8', errors='replace', timeout=180)
    tail = '\n'.join([x for x in (p.stdout or '').splitlines() if x.strip()][-3:])
    return p.returncode, tail


def main():
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except Exception:
        pass
    ap = argparse.ArgumentParser()
    ap.add_argument('--quick', action='store_true')
    ap.add_argument('--real', action='store_true')
    ap.add_argument('--json', action='store_true')
    a = ap.parse_args()
    chosen = CASES[:10] if a.quick else CASES
    rows = []
    for name, kind, rel, extra in chosen:
        cmd = [NODE if kind == 'node' else PY, rel]
        try:
            code, tail = run(cmd, extra)
        except Exception as e:
            code, tail = 999, repr(e)
        rows.append({'name': name, 'code': code, 'tail': tail})
        print(('✓' if code == 0 else '✗') + ' ' + name)
        if code != 0:
            print(tail)
    # dist 全量 + 矩阵
    for name, rel in [('dist 全量', 'scripts/personal/鲸鲸-dist同步检查.py'),
                      ('核心包矩阵', 'scripts/personal/鲸鲸-核心包接入检查.py')]:
        cmd = [PY, rel] + (['--all', '--check'] if name == 'dist 全量' else ['--check'])
        code, tail = run(cmd)
        rows.append({'name': name, 'code': code, 'tail': tail})
        print(('✓' if code == 0 else '✗') + ' ' + name)
        if code != 0:
            print(tail)
    # selfcheck
    code, tail = run([PY, '-B', '-c', "import sys;sys.path.insert(0,'bridge');import selfcheck;r=selfcheck.run_checks();print('selfcheck',r['ok'],r.get('fails'))"], {'WHALE_ROOT': DIST})
    # selfcheck 需在 dist 下，重跑
    p = subprocess.run([PY, '-B', '-c', "import sys;sys.path.insert(0,'bridge');import selfcheck;r=selfcheck.run_checks();print('selfcheck',r['ok'],r.get('fails'))"], cwd=DIST, env=dict(ENV), capture_output=True, text=True, encoding='utf-8', errors='replace', timeout=180)
    code = p.returncode
    tail = (p.stdout or '').strip().splitlines()[-1] if p.stdout.strip() else ''
    if code == 0 and 'selfcheck True' not in tail:
        code = 1
    rows.append({'name': 'selfcheck', 'code': code, 'tail': tail})
    print(('✓' if code == 0 else '✗') + ' selfcheck ' + tail)
    # planned steps
    code, tail = run([PY, 'skills/whale-mainline-integration/scripts/integration_check.py', '--check'])
    rows.append({'name': '接入计划', 'code': code, 'tail': tail})
    print(('✓' if code == 0 else '✗') + ' 接入计划')
    if a.real:
        for rel in ('scripts/personal/鲸鲸-主链审计真实动作.py', 'scripts/personal/鲸鲸-主链真实写审批.py'):
            code, tail = run([PY, rel])
            rows.append({'name': rel, 'code': code, 'tail': tail})
            print(('✓' if code == 0 else '✗') + ' ' + rel)
    if a.json:
        print(json.dumps(rows, ensure_ascii=False, indent=1))
    failed = [r for r in rows if r['code'] != 0]
    print('\n结果：%d/%d 通过' % (len(rows) - len(failed), len(rows)))
    return 1 if failed else 0


if __name__ == '__main__':
    sys.exit(main())
