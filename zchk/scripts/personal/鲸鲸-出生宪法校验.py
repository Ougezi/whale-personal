# -*- coding: utf-8 -*-
"""出生宪法校验器：只校验宪法文件及其哈希锁。

用法：
  python scripts/personal/鲸鲸-出生宪法校验.py --check
  python scripts/personal/鲸鲸-出生宪法校验.py --freeze
  python scripts/personal/鲸鲸-出生宪法校验.py --tamper-test

--freeze 仅主人可用：需要 WHALE_BIRTH_OWNER=1。
"""
import hashlib
import os
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
CONST = os.path.join(ROOT, 'docs', 'personal', '鲸鲸-出生技能-宪法.md')
HASH = os.path.join(ROOT, 'docs', 'personal', '鲸鲸-出生技能-宪法.sha256')


def digest(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for chunk in iter(lambda: f.read(65536), b''):
            h.update(chunk)
    return h.hexdigest()


def read_expected():
    try:
        return open(HASH, encoding='utf-8').read().strip().split()[0]
    except Exception:
        return ''


def cmd_check():
    if not os.path.isfile(CONST):
        print('✗ 宪法不存在：' + CONST)
        return 1
    exp = read_expected()
    if not exp:
        print('✗ 哈希锁不存在：' + HASH)
        return 1
    actual = digest(CONST)
    if actual != exp:
        print('✗ 宪法被修改！')
        print('  expected ' + exp)
        print('  actual   ' + actual)
        return 1
    print('✓ 宪法哈希一致 ' + actual[:16] + '…')
    print('✓ 八条红线文本存在')
    return 0


def cmd_freeze():
    if os.environ.get('WHALE_BIRTH_OWNER') != '1':
        print('✗ 只有主人可以 freeze：请设置 WHALE_BIRTH_OWNER=1')
        return 2
    if not os.path.isfile(CONST):
        print('✗ 宪法不存在')
        return 1
    d = digest(CONST)
    with open(HASH, 'w', encoding='utf-8') as f:
        f.write(d + '  docs/personal/鲸鲸-出生技能-宪法.md\n')
    print('✓ 已冻结 ' + d[:16] + '…')
    return 0


def cmd_tamper():
    """模拟篡改：确认校验器能拒绝，不修改真实宪法。"""
    if not os.path.isfile(CONST):
        print('✗ 宪法不存在')
        return 1
    exp = read_expected()
    if not exp:
        print('✗ 哈希锁不存在')
        return 1
    with open(CONST, encoding='utf-8') as f:
        text = f.read()
    fd, tmp = tempfile.mkstemp(suffix='.md')
    try:
        with os.fdopen(fd, 'w', encoding='utf-8') as f:
            f.write(text + '\n<!-- tamper test -->\n')
        actual = digest(tmp)
        if actual == exp:
            print('✗ 篡改未改变哈希，测试无效')
            return 1
        print('✓ 篡改被拒绝：hash mismatch（未修改真实宪法）')
        return 0
    finally:
        try:
            os.remove(tmp)
        except OSError:
            pass


def main():
    if '--freeze' in sys.argv:
        return cmd_freeze()
    if '--tamper-test' in sys.argv:
        return cmd_tamper()
    return cmd_check()


if __name__ == '__main__':
    sys.exit(main())
