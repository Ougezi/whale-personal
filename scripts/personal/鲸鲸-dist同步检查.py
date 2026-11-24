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


EXCLUDED = {
    'packages/action-core/job.js': '能力储备，未部署到 dist',
    'packages/action-core/registry.js': '能力储备，未部署到 dist',
    'packages/memory-core/commitment.js': '能力储备，未部署到 dist',
    'packages/memory-core/migrate.js': '旧迁移，未部署到 dist',
    'packages/memory-core/receipts.js': '能力储备，未部署到 dist',
    'packages/persona-core/affect.js': '能力储备，未部署到 dist',
    'packages/persona-core/expression.js': '能力储备，未部署到 dist',
    'packages/persona-core/scope.js': '能力储备，未部署到 dist',
    'bridge/birth_config.py': '能力储备，未部署到 dist',
    'bridge/command_bus.py': '能力储备，未部署到 dist',
    'bridge/redteam.py': '能力储备，未部署到 dist',
    'bridge/rollout.py': '能力储备，未部署到 dist',
    'bridge/shadow.py': '能力储备，未部署到 dist',
    'bridge/verify.py': '能力储备，未部署到 dist',
}


def all_files():
    out = []
    for base, _dirs, fs in os.walk(os.path.join(ROOT, 'src')):
        for f in fs:
            if f.endswith('.js'):
                out.append(os.path.relpath(os.path.join(base, f), ROOT).replace('\\', '/'))
    for base, _dirs, fs in os.walk(os.path.join(ROOT, 'packages')):
        for f in fs:
            if f.endswith('.js'):
                out.append(os.path.relpath(os.path.join(base, f), ROOT).replace('\\', '/'))
    for f in os.listdir(os.path.join(ROOT, 'bridge')):
        if f.endswith('.py'):
            out.append('bridge/' + f)
    out.append('server.js')
    return sorted(set(out))


def compare(root=ROOT, dist=DIST, files=None):
    rows = []
    for rel in files or FILES:
        a = os.path.join(root, rel)
        b = os.path.join(dist, rel)
        if not os.path.isfile(a):
            rows.append({'file': rel, 'state': 'source-missing'})
        elif not os.path.isfile(b):
            state = 'excluded' if rel in EXCLUDED else 'dist-missing'
            rows.append({'file': rel, 'state': state, 'reason': EXCLUDED.get(rel, '')})
        else:
            same = sha(a) == sha(b)
            rows.append({'file': rel, 'state': 'same' if same else 'drift',
                         'source': sha(a)[:12], 'dist': sha(b)[:12]})
    bad = [r for r in rows if r['state'] not in ('same', 'excluded')]
    excluded = [r for r in rows if r['state'] == 'excluded']
    return {'ok': not bad, 'checked': len(rows), 'drift': len(bad), 'excluded': len(excluded), 'rows': rows}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--check', action='store_true')
    ap.add_argument('--json', action='store_true')
    ap.add_argument('--all', action='store_true')
    a = ap.parse_args()
    r = compare(files=all_files() if a.all else None)
    if a.json:
        print(json.dumps(r, ensure_ascii=False, indent=1))
    else:
        print('dist 同步：%d 个文件，漂移 %d，排除 %d' % (r['checked'], r['drift'], r.get('excluded', 0)))
        for x in r['rows']:
            if x['state'] in ('drift', 'dist-missing', 'source-missing'):
                print('  ✗ %-40s %s' % (x['file'], x['state']))
            elif x['state'] == 'excluded':
                print('  - %-40s %s' % (x['file'], x.get('reason') or 'excluded'))
        if r['ok']:
            print('  ✓ 源码与 dist 一致')
    return 0 if r['ok'] or not a.check else 1


if __name__ == '__main__':
    sys.exit(main())
