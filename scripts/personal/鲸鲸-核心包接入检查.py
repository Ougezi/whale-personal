# -*- coding: utf-8 -*-
"""核心包接入矩阵检查（I-08）。

只认三种事实：文件存在、状态明确、wired 有接入点/测试。
"""
import argparse
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
MATRIX = os.path.join(ROOT, 'docs', 'personal', '鲸鲸-核心包接入矩阵.json')
STATUS = {'wired', 'not-wired', 'staged'}


def load():
    with open(MATRIX, encoding='utf-8') as f:
        return json.load(f)


def check():
    errs = []
    d = load()
    pkgs = d.get('packages') or []
    bridge = d.get('bridge_contracts') or []
    if len(pkgs) != 11:
        errs.append('packages must be 11, got %d' % len(pkgs))
    ids = [p.get('id') for p in pkgs]
    if len(ids) != len(set(ids)):
        errs.append('duplicate package id')
    for p in pkgs + bridge:
        path = os.path.join(ROOT, p.get('path', ''))
        if not os.path.isfile(path):
            errs.append('missing file ' + str(p.get('path')))
        if p.get('status') not in STATUS:
            errs.append('bad status %s %s' % (p.get('id'), p.get('status')))
    for p in pkgs:
        if p.get('status') == 'wired':
            if not p.get('integration'):
                errs.append('wired without integration: ' + p['id'])
            if not p.get('test'):
                errs.append('wired without test: ' + p['id'])
            elif not os.path.isfile(os.path.join(ROOT, p['test'])):
                errs.append('test file missing: ' + p['test'])
    return {'ok': not errs, 'errors': errs, 'packages': len(pkgs),
            'bridge': len(bridge), 'wired': sum(1 for p in pkgs if p.get('status') == 'wired')}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--check', action='store_true')
    ap.add_argument('--json', action='store_true')
    a = ap.parse_args()
    r = check()
    if a.json:
        print(json.dumps(r, ensure_ascii=False, indent=1))
    else:
        print('核心包：%d 个，wired %d；桥接契约 %d 个' % (r['packages'], r['wired'], r['bridge']))
        for e in r['errors']:
            print('  ✗ ' + e)
        if r['ok']:
            print('  ✓ 矩阵一致')
    return 0 if r['ok'] or not a.check else 1


if __name__ == '__main__':
    sys.exit(main())
