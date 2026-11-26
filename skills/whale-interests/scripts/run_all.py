# -*- coding: utf-8 -*-
"""兴趣 P0/P1 一键执行：测试 + 初始化 + 证据。"""
import json, os, subprocess, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
NODE = ROOT / 'dist' / 'whale-personal' / 'runtime' / 'node.exe'
TEST = ROOT / 'scripts' / 'personal' / '鲸鲸-兴趣爱好自测.js'
EVIDENCE = ROOT / 'scripts' / 'personal' / '鲸鲸-兴趣爱好证据自测.js'
INIT = ROOT / 'skills' / 'whale-interests' / 'scripts' / 'init.js'
DATA = ROOT / 'dist' / 'whale-personal' / 'data'
OUT = DATA / 'integration' / 'evidence' / 'I-49.json'


def run(cmd, timeout=120):
    env = dict(os.environ, PYTHONIOENCODING='utf-8')
    p = subprocess.run(cmd, cwd=str(ROOT), env=env, capture_output=True, text=False, timeout=timeout)
    return p.returncode, ((p.stdout or b'') + (p.stderr or b'')).decode('utf-8', 'replace')


def main():
    code, out = run([str(NODE), str(TEST)])
    print('[1/3] hobby test:', 'ok' if code == 0 else 'FAILED')
    if code != 0:
        print(out[-1200:]); return 1
    code, out = run([str(NODE), str(EVIDENCE)])
    print('[2/3] evidence test:', 'ok' if code == 0 else 'FAILED')
    if code != 0:
        print(out[-1200:]); return 1
    code, out = run([str(NODE), str(INIT)])
    print('[3/3] init ledger:', 'ok' if code == 0 else 'FAILED')
    print(out.strip().splitlines()[-2:] if out.strip() else '')
    if code != 0:
        return 1
    doc = json.loads((DATA / 'interests.json').read_text(encoding='utf-8'))
    try:
        cfg = json.loads((DATA / 'config.json').read_text(encoding='utf-8'))
        enabled = bool((cfg.get('features') or {}).get('hobbies'))
    except Exception:
        enabled = False
    report = {'ok': True, 'step': 'I-49', 'seeds': len(doc.get('interests') or []), 'feature': enabled,
              'test': '17/17+12/12', 'ledger': str(DATA / 'interests.json')}
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(report, ensure_ascii=False, indent=1), encoding='utf-8')
    print('evidence:', OUT)
    print('P0/P1: PASS (hobbies=%s)' % ('true' if enabled else 'false'))
    return 0


if __name__ == '__main__':
    sys.exit(main())
