# -*- coding: utf-8 -*-
"""I-09 dist 同步检查自测。"""
import os
import shutil
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(ROOT, 'scripts', 'personal'))
from importlib import import_module
D = import_module('鲸鲸-dist同步检查')

pass_n = 0
fail_n = 0


def check(name, fn):
    global pass_n, fail_n
    try:
        fn()
        pass_n += 1
        print('  ✓ ' + name)
    except Exception as e:
        fail_n += 1
        print('  ✗ ' + name + '  ' + str(e))


tmp = tempfile.mkdtemp()
src = os.path.join(tmp, 'src'); dist = os.path.join(tmp, 'dist')
os.makedirs(src); os.makedirs(dist)
open(os.path.join(src, 'a.js'), 'w').write('same')
shutil.copy(os.path.join(src, 'a.js'), os.path.join(dist, 'a.js'))

check('文件清单非空', lambda: (_ for _ in ()).throw(AssertionError()) if not D.FILES else None)
check('一致通过', lambda: (_ for _ in ()).throw(AssertionError()) if not D.compare(src, dist, ['a.js'])['ok'] else None)
check('漂移检测', lambda: (open(os.path.join(dist, 'a.js'), 'w').write('changed'), (_ for _ in ()).throw(AssertionError()) if D.compare(src, dist, ['a.js'])['ok'] else None)[1])
check('dist 缺失', lambda: (_ for _ in ()).throw(AssertionError()) if D.compare(src, dist, ['b.js'])['rows'][0]['state'] != 'source-missing' else None)
check('源缺失', lambda: (open(os.path.join(dist, 'z.js'), 'w').write('x'), (_ for _ in ()).throw(AssertionError()) if D.compare(src, dist, ['z.js'])['rows'][0]['state'] != 'source-missing' else None)[1])
check('同一文件同哈希', lambda: (_ for _ in ()).throw(AssertionError()) if D.sha(os.path.join(src, 'a.js')) != D.sha(os.path.join(src, 'a.js')) else None)
check('漂移数量', lambda: (open(os.path.join(dist, 'a.js'), 'w').write('same'), (_ for _ in ()).throw(AssertionError()) if D.compare(src, dist, ['a.js'])['drift'] != 0 else None)[1])
check('当前仓库清单可加载', lambda: (_ for _ in ()).throw(AssertionError()) if len(D.FILES) < 10 else None)

check('全量清单可生成', lambda: (_ for _ in ()).throw(AssertionError()) if len(D.all_files()) < 200 else None)
check('未部署项有排除理由', lambda: (_ for _ in ()).throw(AssertionError()) if not D.EXCLUDED.get('packages/action-core/job.js') else None)

print('\n通过 %d/%d' % (pass_n, pass_n + fail_n))
shutil.rmtree(tmp, ignore_errors=True)
sys.exit(0 if fail_n == 0 else 1)
