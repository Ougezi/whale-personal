# -*- coding: utf-8 -*-
"""24 live 契约必须全部有执行器映射；目录 313 只做数量/类别可见，不强行 1:1。"""
import json, os, sys
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
M = json.load(open(os.path.join(ROOT, 'data', 'integration', 'case-map.json'), encoding='utf-8'))
P = F = 0
def c(n, ok, x=''):
    global P, F
    if ok: P += 1; print('  ✓ ' + n)
    else: F += 1; print('  ✗ ' + n + (' ' + x if x else ''))
rows = M.get('rows') or []
c('24 条 live 全在映射', len(rows) == 24 and len({r['live'] for r in rows}) == 24, str(len(rows)))
c('目录 313 可见', M.get('catalog_count') == 313, str(M.get('catalog_count')))
c('每条 live 有 runner', all(r.get('runner') for r in rows))
c('每条 live 有 source', all(r.get('source') in ('GitHub', 'B站', '抖音') for r in rows))
c('目录/live 未伪造 1:1', all('catalog_ids' in r and r.get('mapping') == 'operation-contract' for r in rows))
print('\n通过 %d/%d' % (P, P + F))
sys.exit(0 if F == 0 else 1)
