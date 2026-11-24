# -*- coding: utf-8 -*-
"""P3 · 平台发布控制 CLI（不发消息、不改主链）。"""
import argparse
import json
import os
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(ROOT, 'bridge'))
import platform_control as C

DATA = os.environ.get('WHALE_DATA_DIR') or os.path.join(ROOT, 'data')


def main():
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest='cmd', required=True)
    sub.add_parser('birth')
    p = sub.add_parser('birth-set'); p.add_argument('skill'); p.add_argument('value', type=int)
    p = sub.add_parser('rollout'); p.add_argument('--platform'); p.add_argument('--percent', type=int)
    p = sub.add_parser('genome'); p.add_argument('--version', type=int, default=1)
    sub.add_parser('sandbox')
    sub.add_parser('redteam')
    a = ap.parse_args()
    if a.cmd == 'birth':
        print(json.dumps(C.birth_status(DATA), ensure_ascii=False, indent=1))
    elif a.cmd == 'birth-set':
        print(json.dumps(C.birth_set(DATA, a.skill, bool(a.value)), ensure_ascii=False, indent=1))
    elif a.cmd == 'rollout':
        if a.platform:
            print(json.dumps(C.rollout_set(DATA, a.platform, a.percent or 0), ensure_ascii=False, indent=1))
        else:
            print(json.dumps(C.rollout_status(DATA), ensure_ascii=False, indent=1))
    elif a.cmd == 'genome':
        print(json.dumps(C.genome_register(DATA, a.version), ensure_ascii=False, indent=1))
    elif a.cmd == 'sandbox':
        d = tempfile.mkdtemp(prefix='whale-p3-')
        with open(os.path.join(d, 'a.txt'), 'w', encoding='utf-8') as f:
            f.write('x\n')
        diff = '--- a/a.txt\n+++ b/a.txt\n@@ -1 +1 @@\n-x\n+y\n'
        print(json.dumps(C.sandbox_run(d, ['a.txt'], diff, {'a.txt': 'y\n'}), ensure_ascii=False, indent=1))
    elif a.cmd == 'redteam':
        print(json.dumps(C.redteam_run(), ensure_ascii=False, indent=1))


if __name__ == '__main__':
    main()
