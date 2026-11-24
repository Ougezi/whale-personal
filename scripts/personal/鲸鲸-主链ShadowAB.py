# -*- coding: utf-8 -*-
"""I-24：persona-shadow A/B 报告 + 主人授权门槛；不自动替换人格。"""
import argparse
import json
import os
import sys
import time
from collections import Counter

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DEFAULT = os.path.join(ROOT, 'dist', 'whale-personal', 'data', 'persona-shadow.jsonl')
APPROVAL = os.path.join(ROOT, 'data', 'integration', 'shadow-approval.json')


def load(path):
    rows = []
    try:
        with open(path, encoding='utf-8') as f:
            for line in f:
                line = line.strip()
                if line:
                    try: rows.append(json.loads(line))
                    except Exception: pass
    except Exception:
        pass
    return rows


def report(path):
    rows = load(path)
    labels = Counter((r.get('affect') or {}).get('label') or 'unknown' for r in rows)
    scopes = Counter('group' if 'group:' in str(r.get('scope') or '') else 'private' for r in rows)
    lit = sum(int((r.get('expression') or {}).get('literals') or 0) for r in rows)
    mk = sum(int((r.get('expression') or {}).get('markers') or 0) for r in rows)
    quality = {'labels>=2': len(labels) >= 2, 'literals>0': lit > 0}
    return {'ok': len(rows) > 0, 'samples': len(rows), 'labels': dict(labels),
            'scopes': dict(scopes), 'literals': lit, 'markers': mk,
            'quality': quality, 'enough': len(rows) >= 20 and all(quality.values()), 'path': path}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--shadow', default=DEFAULT)
    ap.add_argument('--json', action='store_true')
    ap.add_argument('--owner', default='')
    ap.add_argument('--approve', action='store_true')
    ap.add_argument('--approval', default=APPROVAL)
    a = ap.parse_args()
    r = report(a.shadow)
    if a.approve:
        if not a.owner.strip():
            print('拒绝：必须写 --owner <主人>')
            return 2
        if not r['enough']:
            print('拒绝：样本不足 20 或质量门槛未过，不能批')
            return 3
        target = a.approval
        os.makedirs(os.path.dirname(target), exist_ok=True)
        row = {'by': a.owner.strip(), 'at': int(time.time() * 1000), 'samples': r['samples'],
               'labels': r['labels'], 'decision': 'approved-for-next-stage', 'note': '只批准进入下一阶段，不自动替换人格'}
        with open(target, 'w', encoding='utf-8') as f:
            json.dump(row, f, ensure_ascii=False, indent=1)
        print('授权记录已写：' + target)
    if a.json:
        print(json.dumps(r, ensure_ascii=False, indent=1))
    else:
        print('samples=%d enough=%s literals=%d markers=%d' % (r['samples'], r['enough'], r['literals'], r['markers']))
        print('labels=' + json.dumps(r['labels'], ensure_ascii=False))
    return 0


if __name__ == '__main__':
    sys.exit(main())
