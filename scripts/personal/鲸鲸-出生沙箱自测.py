# -*- coding: utf-8 -*-
"""B4-02 沙箱自测：主链不变、diff 校验、测试/评测不过不提升、可清理。"""
import os
import shutil
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(ROOT, 'bridge'))
from evolution import sandbox as S  # noqa: E402

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


base = tempfile.mkdtemp(prefix='whale-evo-main-')
os.makedirs(os.path.join(base, 'prompts'))
open(os.path.join(base, 'prompts', 'greet.txt'), 'w', encoding='utf-8').write('hello\nworld\n')
FILES = ['prompts/greet.txt']
DIFF = '--- a/prompts/greet.txt\n+++ b/prompts/greet.txt\n@@ -1,2 +1,2 @@\n hello\n-world\n+whale\n'
BEFORE = S.fingerprint(base, FILES)


def main_text():
    return open(os.path.join(base, 'prompts', 'greet.txt'), encoding='utf-8').read()


def raises(fn):
    try:
        fn()
    except Exception:
        return
    raise AssertionError('did not raise')


check('沙箱复制不碰主链', lambda: (_ for _ in ()).throw(AssertionError()) if (S.create_sandbox(base, FILES)['root'] == base) else None)
check('diff 可应用', lambda: (_ for _ in ()).throw(AssertionError()) if S.apply_diff(S.create_sandbox(base, FILES), DIFF)['lines'] != 2 else None)
check('上下文不匹配拒绝', lambda: raises(lambda: S.apply_diff(S.create_sandbox(base, FILES), '--- a/prompts/greet.txt\n+++ b/prompts/greet.txt\n@@ -1 +1 @@\n-wrong\n+x\n')))
check('未声明文件拒绝', lambda: raises(lambda: S.apply_diff(S.create_sandbox(base, FILES), '--- a/x\n+++ b/x\n@@ -1 +1 @@\n-a\n+b\n')))
check('无 hunk 拒绝', lambda: raises(lambda: S.apply_diff(S.create_sandbox(base, FILES), '--- a/prompts/greet.txt\n+++ b/prompts/greet.txt\n')))

check('测试过 => promoted', lambda: (_ for _ in ()).throw(AssertionError()) if not S.run_cycle(base, FILES, DIFF, [[sys.executable, '-c', 'print(1)']])['ok'] else None)
check('测试失败 => 不提升', lambda: (_ for _ in ()).throw(AssertionError()) if S.run_cycle(base, FILES, DIFF, [[sys.executable, '-c', 'import sys; sys.exit(1)']])['reason'] != 'tests_failed' else None)
check('shadow 失败 => 不提升', lambda: (_ for _ in ()).throw(AssertionError()) if S.run_cycle(base, FILES, DIFF, [[sys.executable, '-c', 'print(1)']], ['a'], lambda c: False)['reason'] != 'shadow_failed' else None)
check('主链始终不变', lambda: (_ for _ in ()).throw(AssertionError()) if main_text() != 'hello\nworld\n' or S.fingerprint(base, FILES) != BEFORE else None)
check('沙箱已清理', lambda: (_ for _ in ()).throw(AssertionError()) if os.path.exists(S.run_cycle(base, FILES, DIFF, [[sys.executable, '-c', 'print(1)']])['sandbox']) else None)
check('评测独立', lambda: (_ for _ in ()).throw(AssertionError()) if not S.run_shadow(['a', 'b'], lambda c: c in ('a', 'b'))['ok'] else None)
check('回归可复现', lambda: (_ for _ in ()).throw(AssertionError()) if S.run_cycle(base, FILES, DIFF, [[sys.executable, '-c', 'print(1)']])['ok'] != S.run_cycle(base, FILES, DIFF, [[sys.executable, '-c', 'print(1)']])['ok'] else None)

print('\n通过 %d/%d' % (pass_n, pass_n + fail_n))
shutil.rmtree(base, ignore_errors=True)
sys.exit(0 if fail_n == 0 else 1)
