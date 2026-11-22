#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
鲸鲸 · 个人版：改身份（版本号 + 更新渠道）。

- package.json / csproj：4.1.8 → 4.2.0（个人版线，从官方 4.1.8 起跳）
- UpdateManifest.cs / UpdateService.cs：把更新来源从 Banan1cee/whale_girl 改成 Ougezi/whale-personal
  （只改「应用更新」这条链路；插件市场仍是官方 catalog，见 README 说明）
"""
import os
import re
import shutil
import sys
import time

FORK = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'src')
PKG = os.path.join(FORK, 'package.json')
CSPROJ = os.path.join(FORK, 'launcher', 'WhaleLauncher.csproj')
UM = os.path.join(FORK, 'launcher', 'UpdateManifest.cs')
US = os.path.join(FORK, 'launcher', 'UpdateService.cs')

OLD_REPO = 'Banan1cee/whale_girl'
NEW_REPO = 'Ougezi/whale-personal'

PLAN = [
    (PKG, '"version": "4.1.8"', '"version": "4.2.0"', 'package.json 版本', 1),
    (CSPROJ, '<Version>4.1.7</Version>', '<Version>4.2.0</Version>', 'csproj Version', 1),
    (CSPROJ, '<FileVersion>4.1.7.0</FileVersion>', '<FileVersion>4.2.0.0</FileVersion>', 'csproj FileVersion', 1),
    (UM, 'private const string Repo = "Banan1cee/whale_girl";', 'private const string Repo = "Ougezi/whale-personal";', '更新仓库常量', 1),
]


def main():
    check_only = '--check' in sys.argv
    texts = {}
    for path, _o, _n, _l, _c in PLAN + [(US, '', '', 'update-service', 0)]:
        if path in texts:
            continue
        with open(path, 'r', encoding='utf-8', newline='') as f:
            texts[path] = f.read()

    staged = {}
    for path, old, new, label, _count in PLAN:
        text = staged.get(path, texts[path])
        if text.count(old) != 1:
            print('[失败] %s 锚点数 = %d' % (label, text.count(old)))
            return 1
        staged[path] = text.replace(old, new, 1)

    # UpdateService 里所有 whale_girl 的下载/发布页地址，一并指向个人仓库
    us = staged.get(US, texts[US])
    if OLD_REPO not in us:
        print('[跳过] UpdateService 里没有官方仓库地址（可能已改过）')
    else:
        us2 = us.replace(OLD_REPO, NEW_REPO)
        staged[US] = us2
        print('[计划] UpdateService 地址替换 %d 处' % (us.count(OLD_REPO)))

    if check_only:
        for path in staged:
            print('[可改身份] %s' % os.path.relpath(path, FORK))
        return 0

    stamp = time.strftime('%Y%m%d-%H%M%S')
    backups = []
    try:
        for path in staged:
            bak = path + '.bak-id-' + stamp
            shutil.copy2(path, bak)
            backups.append((path, bak))
            tmp = path + '.tmp-id'
            with open(tmp, 'w', encoding='utf-8', newline='') as f:
                f.write(staged[path])
            os.replace(tmp, path)
    except Exception as err:  # noqa: BLE001
        for path, bak in backups:
            shutil.copy2(bak, path)
        print('[失败] 已回滚：%s' % err)
        return 1

    for path in staged:
        print('[已改] ' + os.path.relpath(path, FORK))
    print('[备份] ' + ', '.join(os.path.basename(b) for _p, b in backups))
    return 0


if __name__ == '__main__':
    sys.exit(main())
