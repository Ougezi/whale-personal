# -*- coding: utf-8 -*-
"""0-1000 案例底座的覆盖门禁：不硬凑数量，但必须 schema 完整、分布可见、live 有证据。"""
import json, os, sys, collections
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
CASE = os.path.join(ROOT, 'docs', 'personal', '鲸鲸-出生技能-案例库-313.json')
LIVE = os.path.join(ROOT, 'data', 'integration', 'evidence', 'I-36-live.json')
P = F = 0
def c(n, ok, extra=''):
    global P, F
    if ok: P += 1; print('  ✓ ' + n)
    else: F += 1; print('  ✗ ' + n + (' ' + extra if extra else ''))

d = json.load(open(CASE, encoding='utf-8'))
items = d if isinstance(d, list) else (d.get('cases') or d.get('items') or [])
ids = [str(x.get('id') or '') for x in items]
c('案例数量在 0-1000 槽位', 200 <= len(items) <= 1000, str(len(items)))
c('ID 无重复', len(ids) == len(set(ids)), str(len(ids) - len(set(ids))))
c('每条有 source/title/url', all(x.get('source') and x.get('title') and x.get('url') for x in items))
src = collections.Counter(x.get('source') for x in items)
cat = collections.Counter(x.get('category') for x in items)
print('  分布:', dict(src))
print('  类别:', dict(cat))
ext_items = []
try:
    for fn in ('鲸鲸-平台案例-扩展-20.json', '鲸鲸-平台案例-扩展-20b.json', '鲸鲸-平台案例-扩展-12.json'):
        ext_items += json.load(open(os.path.join(ROOT, 'docs', 'personal', fn), encoding='utf-8')).get('items') or []
    ext_src = collections.Counter(x.get('source') for x in ext_items)
    c('B站/抖音各 30 条', ext_src.get('B站') == 20 and ext_src.get('抖音') == 20, str(dict(ext_src)))
    ext_cat = collections.Counter(x.get('category') for x in ext_items)
    total_cat = cat + ext_cat
    c('plugin/safety/product 各 >=10', all(total_cat.get(k, 0) >= 10 for k in ('plugin', 'safety', 'product')), str(dict(total_cat)))
except Exception as e:
    c('B站/抖音各 30 条', False, repr(e))

c('GitHub/B站/抖音三源都有', all(src.get(k, 0) >= 10 for k in ('GitHub', 'B站', '抖音')), str(dict(src)))
try:
    live = json.load(open(LIVE, encoding='utf-8'))
    c('24 条 live 平台案例通过', live.get('total') == 24 and live.get('passed') == 24,
      '%s/%s' % (live.get('passed'), live.get('total')))
    rows = live.get('rows') or []
    success_rows = [r for r in rows if r.get('ok') and not r.get('code')]
    c('live 成功案例都有 readback/source', all(r.get('evidence', {}).get('readback') and r.get('evidence', {}).get('source') for r in success_rows), str(len(success_rows)))
except Exception as e:
    c('24 条 live 平台案例通过', False, repr(e))
print('\n通过 %d/%d' % (P, P + F))
sys.exit(0 if F == 0 else 1)
