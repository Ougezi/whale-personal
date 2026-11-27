# -*- coding: utf-8 -*-
"""微信文件路径兼容：msg/file 与 FileStorage/File 都要能找到。"""
import os, sys, tempfile
from pathlib import Path
ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'bridge'))
import doc_download as d
P = F = 0
def c(n, ok):
    global P, F
    if ok: P += 1; print('  ✓ ' + n)
    else: F += 1; print('  ✗ ' + n)

with tempfile.TemporaryDirectory() as tmp:
    acct = Path(tmp) / 'wxid_test'
    (acct / 'FileStorage' / 'File' / '2026-11').mkdir(parents=True)
    f = acct / 'FileStorage' / 'File' / '2026-11' / '1_手册.pdf'
    f.write_bytes(b'pdf')
    c('候选目录包含 FileStorage', any('FileStorage' in x for x in d.candidate_bases(str(acct))))
    c('按文件名找到', d.find_local_file(str(acct), ['1_手册.pdf']) == str(f))
    c('按大小找到', d.find_by_size(str(acct), 3, '.pdf') == str(f))
    c('不存在的文件不误报', d.find_local_file(str(acct), ['nope.pdf']) is None)
    c('无 GUI 不点击', d._click_file_card(None, 'x.pdf') is False)

print('\n通过 %d/%d' % (P, P + F))
raise SystemExit(0 if F == 0 else 1)
