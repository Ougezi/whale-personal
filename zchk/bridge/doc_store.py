# -*- coding: utf-8 -*-
"""文档读取的轻量辅助：重复文件去重 + 正文落盘。

去重：同一份文件（标题 + 大小）在 ttl 内重复发送时，不再把整篇重复读进上下文。
      本机实测过：同一份日记连发几次后，历史里堆了多份（其中还有旧的截断版本），
      模型会被带偏（"写到2020年1月23日就断了"就是这么来的）。
落盘：提取出的正文存到 data/docs/<sha1>.txt，为以后「按需回查原文」留好数据。
"""
import hashlib
import json
import os
import re
import time

CACHE_NAME = 'doc-read-cache.json'
DEFAULT_TTL = 3600


def _clean(text):
    s = str(text or '').strip()
    m = re.match(r'^<!\[CDATA\[(.*)\]\]>$', s, re.S)
    if m:
        s = m.group(1).strip()
    return s


def key_from_content(content):
    """从文件消息 XML 里取去重键：标题 + 大小 + attachid。

    只用「标题+大小」时，同名同大小的不同文件会被误判成重复；
    attachid 里带着文件的唯一标识（_<md5>_<n>），加上它更准。
    """
    title = ''
    m = re.search(r'<title>(.*?)</title>', content or '', re.S)
    if m:
        title = _clean(m.group(1))
    if not title:
        return ''
    size = ''
    m = re.search(r'<totallen>(.*?)</totallen>', content or '', re.S)
    if m:
        size = _clean(m.group(1))
    aid = ''
    m = re.search(r'<attachid>(.*?)</attachid>', content or '', re.S)
    if m:
        raw = _clean(m.group(1))
        hit = re.search(r'_([0-9a-fA-F]{16,})', raw)
        aid = hit.group(1) if hit else raw[:60]
    return '%s|%s|%s' % (title, size, aid)


def _load(path):
    try:
        with open(path, encoding='utf-8') as f:
            d = json.load(f)
        return d if isinstance(d, dict) else {}
    except Exception:
        return {}


def _save(path, data):
    try:
        d = os.path.dirname(path)
        if d:
            os.makedirs(d, exist_ok=True)
        tmp = path + '.tmp'
        with open(tmp, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False)
        os.replace(tmp, path)
    except Exception:
        pass


def _prune(data, ttl):
    now = time.time()
    return {k: v for k, v in data.items() if now - float(v or 0) < ttl}


def is_recent_dup(root, key, ttl=DEFAULT_TTL):
    if not key:
        return False
    path = os.path.join(root, 'data', CACHE_NAME)
    return key in _prune(_load(path), ttl)


def remember(root, key, ttl=DEFAULT_TTL):
    if not key:
        return
    path = os.path.join(root, 'data', CACHE_NAME)
    data = _prune(_load(path), ttl)
    data[key] = time.time()
    _save(path, data)


def _prune_docs(directory, keep=200):
    """docs 只留最近 200 份，避免无限增长。"""
    try:
        files = [os.path.join(directory, f) for f in os.listdir(directory) if f.endswith('.txt')]
        files.sort(key=lambda p: os.path.getmtime(p))
        for old in files[:-keep]:
            try:
                os.remove(old)
            except Exception:
                pass
    except Exception:
        pass


def hash_text(text):
    """正文的短哈希（和 data/docs 下的文件名一致）。"""
    try:
        body = str(text or "")
        if not body:
            return ""
        return hashlib.sha1(body.encode("utf-8")).hexdigest()[:16]
    except Exception:
        return ""


def save_text(root, name, text):
    """正文落盘到 data/docs/<sha1>.txt，返回路径（失败返回空串）。"""
    try:
        body = str(text or '')
        if not body:
            return ''
        digest = hashlib.sha1(body.encode('utf-8')).hexdigest()[:16]
        d = os.path.join(root, 'data', 'docs')
        os.makedirs(d, exist_ok=True)
        p = os.path.join(d, digest + '.txt')
        if not os.path.exists(p):
            with open(p, 'w', encoding='utf-8') as f:
                f.write(body)
            _prune_docs(d)
        return p
    except Exception:
        return ''
