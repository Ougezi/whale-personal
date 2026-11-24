# -*- coding: utf-8 -*-
"""源码 ↔ dist 同步检查（I-09）。

只检查“已接入主链的关键文件”，不把整个 dist 和源码比较（dist 有运行时生成物）。
--check：有任何漂移返回 1。
"""
import argparse
import hashlib
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DIST = os.path.join(ROOT, 'dist', 'whale-personal')

FILES = [
    'server.js',
    'src/app.js',
    'src/infra/config.js',
    'src/infra/features.js',
    'src/memory/chatStore.js',
    'src/memory/store.js',
    'src/memory/eventSink.js',
    'src/persona/promptMemory.js',
    'src/pipeline/chat.js',
    'packages/memory-core/events.js',
    'packages/memory-core/working.js',
    'bridge/send_guard.py',
    'bridge/sender_mixin.py',
    'bridge/action_guard.py',
    'bridge/action_audit.py',
    'bridge/delegation_approval.py',
    'bridge/brain_agent.py',
    'bridge/receiver_mixin.py',
]


def sha(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for b in iter(lambda: f.read(65536), b''):
            h.update(b)
    return h.hexdigest()


def compare(root=ROOT, dist=DIST, files=None):
    rows = []
    for rel in files or FILES:
        a = os.path.join(root, rel)
        b = os.path.join(dist, rel)
        if not os.path.isfile(a):
            rows.append({'file': rel, 'state': 'source-missing'})
        elif not os.path.isfile(b):
            rows.append({'file': rel, 'state': 'dist-missing'})
        else:
            same = sha(a) == sha(b)
            rows.append({'file': rel, 'state': 'same' if same else 'drift',
                         'source': sha(a)[:12], 'dist': sha(b)[:12]})
    bad = [r for r in rows if r['state'] != 'same']
    return {'ok': not bad, 'checked': len(rows), 'drift': len(bad), 'rows': rows}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--check', action='store_true')
    ap.add_argument('--json', action='store_true')
    a = ap.parse_args()
    r = compare()
    if a.json:
        print(json.dumps(r, ensure_ascii=False, indent=1))
    else:
        print('dist 同步：%d 个关键文件，漂移 %d' % (r['checked'], r['drift']))
        for x in r['rows']:
            if x['state'] != 'same':
                print('  ✗ %-40s %s' % (x['file'], x['state']))
        if r['ok']:
            print('  ✓ 源码与 dist 一致')
    return 0 if r['ok'] or not a.check else 1


if __name__ == '__main__':
    sys.exit(main())
