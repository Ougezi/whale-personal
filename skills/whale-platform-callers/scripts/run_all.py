# -*- coding: utf-8 -*-
"""P0 一步执行：离线自测 + 24 live 案例 + 可选抖音 status + 证据。"""
import argparse
import json
import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
BRIDGE = ROOT / 'bridge'
PY = sys.executable
SELFTEST = ROOT / 'scripts' / 'personal' / '鲸鲸-真实调用方自测.py'
CASES = ROOT / 'scripts' / 'personal' / '鲸鲸-真实调用方-24案例.py'
DATA = ROOT / 'data'
if not DATA.exists():
    DATA = ROOT / 'dist' / 'whale-personal' / 'data'
OUT = DATA / 'integration' / 'evidence' / 'I-36-live.json'
SKILL_OUT = DATA / 'integration' / 'evidence' / 'I-36-skill.json'


def run(cmd, timeout=300):
    env = dict(os.environ)
    env['PYTHONIOENCODING'] = 'utf-8'
    p = subprocess.run(cmd, cwd=str(ROOT), env=env, capture_output=True, text=False, timeout=timeout)
    out = (p.stdout or b'').decode('utf-8', 'replace')
    err = (p.stderr or b'').decode('utf-8', 'replace')
    return p.returncode, out, err


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--live', action='store_true', help='跑真实 GitHub/B站只读案例')
    ap.add_argument('--douyin', action='store_true', help='额外跑抖音 sidecar status（不刷内容）')
    ap.add_argument('--skip-selftest', action='store_true')
    a = ap.parse_args()
    report = {'ok': False, 'steps': {}}

    if not a.skip_selftest:
        code, out, err = run([PY, str(SELFTEST)], timeout=120)
        report['steps']['selftest'] = {'ok': code == 0, 'tail': (out or err).strip().splitlines()[-3:]}
        print('[1/3] selftest:', 'ok' if code == 0 else 'FAILED')
        if code != 0:
            print(out[-1200:]); print(err[-800:])
            _write(report); return 1

    code, out, err = run([PY, str(CASES), '--live'] + (['--douyin'] if a.douyin else []), timeout=300)
    report['steps']['cases'] = {'ok': code == 0, 'tail': (out or err).strip().splitlines()[:3]}
    print('[2/3] live cases:', 'ok' if code == 0 else 'FAILED')
    if code != 0:
        print(out[-1600:]); print(err[-800:])
        _write(report); return 1

    if a.douyin:
        sys.path.insert(0, str(BRIDGE))
        try:
            from platform_douyin import DouyinAdapter
            d = DouyinAdapter()
            st = d.execute('status', {})
            report['steps']['douyin'] = {'available': d.available(), 'status': st}
            print('[3/3] douyin status:', 'ok' if st.get('ok') else 'unavailable/' + str(st.get('code')))
        except Exception as e:
            report['steps']['douyin'] = {'error': str(e)[:200]}
            print('[3/3] douyin status: error', str(e)[:120])
    else:
        print('[3/3] douyin: skipped (--douyin to probe)')

    ev = {}
    if OUT.exists():
        try:
            ev = json.loads(OUT.read_text(encoding='utf-8'))
        except Exception:
            ev = {}
    report['evidence'] = {'path': str(OUT), 'total': ev.get('total'), 'passed': ev.get('passed')}
    report['ok'] = bool(ev.get('ok')) and ev.get('total') == 24 and ev.get('passed') == 24
    _write(report)
    print('evidence:', OUT)
    print('P2:', 'PASS' if report['ok'] else 'FAILED')
    return 0 if report['ok'] else 1


def _write(report):
    SKILL_OUT.parent.mkdir(parents=True, exist_ok=True)
    SKILL_OUT.write_text(json.dumps(report, ensure_ascii=False, indent=1), encoding='utf-8')


if __name__ == '__main__':
    sys.exit(main())
