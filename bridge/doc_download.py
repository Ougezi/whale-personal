# -*- coding: utf-8 -*-
"""文件消息下载：按「XML 标题里的文件名」在 <账号>/msg/file 下找文件。

背景（本机实测，微信 4.x）：
  1. 消息行的 local_type 是 25769803825，低 32 位才是 49；
     wechatauto 的 download_file / download_media 写死 == 49，永远返回 None。
  2. message_resource.packed_info 是 protobuf，_file_name() 解出来带控制字节；
     而且桥接里这张表的解密缓存可能还没刷新到刚到的消息，取不到名字。
  3. 微信遇到重名会存成「名(1).ext」「名(2).ext」，不能只按原名匹配。

所以：以消息 XML 的 <title> 为主线索（调用方传入 hint_name），
再补上 message_resource 里的候选名，展开重名变体后精确匹配磁盘。
"""
import os
import re
import shutil
import time

FILE_LOCAL_TYPE = 49
CONTROL = re.compile(r'[\x00-\x1f\x7f]+')


def _clean(name):
    s = str(name or '').strip()
    m = re.match(r'^<!\[CDATA\[(.*)\]\]>$', s, re.S)
    if m:
        s = m.group(1).strip()
    return s


def _candidates(raw):
    """从 message_resource 的 packed_info 解码串里提炼可能的文件名。

    protobuf 的长度前缀有可能是可打印 ASCII（比如 'l4武汉…'、'D 水仙…'），
    按控制字符切完还会带着前缀；这里额外产出「从第一个汉字开始」的变体，
    否则中文文件名永远匹配不上磁盘。
    """
    out = []
    for part in CONTROL.split(str(raw or '')):
        part = _clean(part)
        if not part or len(part) > 200 or '.' not in part:
            continue
        out.append(part)
        for i, ch in enumerate(part):
            if '\u4e00' <= ch <= '\u9fff':
                if i:
                    out.append(part[i:])
                break
    return out


def _variants(name):
    """原名 + 微信重名时的「名(1).ext」「名(2).ext」……"""
    name = _clean(name)
    if not name:
        return []
    base, ext = os.path.splitext(name)
    out = [name]
    for i in range(1, 20):
        out.append('%s(%d)%s' % (base, i, ext))
    return out


def candidate_bases(account_dir):
    """微信 3.x/4.x 的文件落盘目录不止一个，不能只认 msg/file。"""
    if not account_dir:
        return []
    out = []
    for rel in (('msg', 'file'), ('FileStorage', 'File')):
        p = os.path.join(account_dir, *rel)
        if os.path.isdir(p):
            out.append(p)
    return out


def find_local_file(account_dir, names):
    """在账号的 msg/file 与 FileStorage/File 下按文件名精确匹配。"""
    if not account_dir or not names:
        return None
    want = set(names)
    for base in candidate_bases(account_dir):
        for root, _dirs, files in os.walk(base):
            for f in files:
                if f in want:
                    return os.path.join(root, f)
    return None


def find_by_size(account_dir, size, ext=''):
    """按文件大小兜底找：微信把文件写盘后大小是确定的，比名字可靠。"""
    if not account_dir or not size:
        return None
    ext = str(ext or '').lower()
    for base in candidate_bases(account_dir):
        for root, _dirs, files in os.walk(base):
            for f in files:
                if ext and not f.lower().endswith(ext):
                    continue
                p = os.path.join(root, f)
                try:
                    if os.path.getsize(p) == int(size):
                        return p
                except Exception:
                    continue
    return None


def _click_file_card(gui, name):
    """在当前会话点一次文件卡片，触发微信下载；返回是否点到。"""
    if not gui or not name:
        return False
    try:
        uia = gui._get_uia() if hasattr(gui, '_get_uia') else getattr(gui, '_uia', None)
        if uia is None or not hasattr(uia, 'find_in_message_list'):
            return False
        hit = uia.find_in_message_list(
            lambda cn, nm: bool(nm) and (name in nm or nm.endswith(name)),
            match_last=True, max_scrolls=20)
        if not hit:
            return False
        rect = hit[2]
        x = int((rect.left + rect.right) / 2)
        y = int((rect.top + rect.bottom) / 2)
        gui.wx_click(x, y)
        return True
    except Exception:
        return False


def _copy_hit(hit, user, local_id, save_dir):
    os.makedirs(save_dir, exist_ok=True)
    out = os.path.join(save_dir, '%s_%s_%s' % (user, local_id, os.path.basename(hit)))
    try:
        if os.path.exists(out):
            os.remove(out)
    except Exception:
        out = '%s.%d' % (out, int(time.time() * 1000))
    try:
        shutil.copy2(hit, out)
    except Exception:
        alt = '%s.%d' % (out, int(time.time() * 1000))
        shutil.copy2(hit, alt)
        out = alt
    return out


def download_document(db, downloader, user, local_id, save_dir, hint_name='', hint_size=0, hint_ext='', gui=None):
    """返回 (本地路径, 原始文件名)；找不到抛 RuntimeError(原因)。"""
    try:
        rows = db.get_message_rows_for_media(user, int(local_id)) or []
    except Exception:
        rows = []

    names = []
    is_file = False
    for row in rows:
        lt = int(row.get('local_type') or 0)
        if (lt & 0xFFFFFFFF) != FILE_LOCAL_TYPE:
            continue
        is_file = True
        try:
            names.extend(_candidates(downloader._file_name(row) or ''))
        except Exception:
            pass
    if rows and not is_file:
        raise RuntimeError('这条消息不是文件消息')

    # XML 里的标题是最可靠的主线索（不依赖 message_resource 是否已刷新）
    names.extend(_variants(hint_name))

    ordered, seen = [], set()
    for n in names:
        if n and n not in seen:
            seen.add(n)
            ordered.append(n)

    account_dir = getattr(db, 'account_dir', '') or ''
    # 新消息的文件可能是「消息先到、文件后落盘」：最长等 ~10 秒再判失败。
    # 本机实测：2 MB 的 PDF 大约 2 秒后才出现在 msg/file 下。
    for attempt in range(10):
        hit = find_local_file(account_dir, ordered)
        if not hit and hint_size:
            hit = find_by_size(account_dir, hint_size, hint_ext)
        if hit:
            out = _copy_hit(hit, user, local_id, save_dir)
            if attempt:
                print('文件等了 %.1f 秒才落盘' % (attempt * 1.0))
            return out, os.path.basename(hit)
        time.sleep(1.0)

    # 本地没有：点一次文件卡片，触发微信自己下载，再等它落盘。
    if gui and hint_name and _click_file_card(gui, hint_name):
        for attempt in range(30):
            hit = find_local_file(account_dir, ordered) if hint_name else None
            if not hit and hint_size:
                hit = find_by_size(account_dir, hint_size, hint_ext)
            if hit:
                out = _copy_hit(hit, user, local_id, save_dir)
                print('点击文件卡片后 %.1f 秒落盘' % (attempt * 1.0))
                return out, os.path.basename(hit)
            time.sleep(1.0)
    raise RuntimeError('本地找不到这个文件（微信可能没缓存，或不是文件消息）')
