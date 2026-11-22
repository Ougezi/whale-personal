# -*- coding: utf-8 -*-
"""给鲸鲸的「找图发图」链路：按关键词搜图 → 下载 → 校验 → 存进表情库 → 交给桥接发送。

为什么单独做，而不是派给执行端：
    DSH 执行端能读写文件、跑命令，但它**发不了微信消息**。发图必须走桥接的 send_sticker。
    所以这条路是：她写 [[pic:关键词]] → 本模块找图 → 桥接发送。
"""
import hashlib
import os
import re
import time
import urllib.parse
import urllib.request

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/120.0 Safari/537.36")

MAX_BYTES = 3 * 1024 * 1024      # 单张上限 3MB
MIN_BYTES = 6 * 1024             # 太小多半是图标/占位图
TIMEOUT = 15

MARKER_RE = re.compile(r"\[\[pic:(.+?)\]\]", re.S)


def extract(text):
    """抽出 [[pic:关键词]]，返回 (清理后文本, 关键词)。"""
    s = str(text or "")
    keys = [k.strip() for k in MARKER_RE.findall(s) if k.strip()]
    clean = MARKER_RE.sub("", s)
    clean = re.sub(r"[，,、]\s*[。！？!?]", "。", clean)
    clean = re.sub(r"\n{3,}", "\n\n", clean).strip()
    if keys and len(clean) < 6:
        clean = "等我找张图～"
    return clean, "；".join(dict.fromkeys(keys))


def _get(url, timeout=TIMEOUT, referer=None):
    headers = {"User-Agent": UA, "Accept-Language": "zh-CN,zh;q=0.9"}
    if referer:
        headers["Referer"] = referer
    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()



# 图库/电商/素材站：标题沾边但图是白底素材或商品，直接排除
BAD_HOSTS = ("699pic", "588ku", "ztupic", "58pic", "vcg", "gettyimages", "shutterstock",
             "pngtree", "lovepik", "51miz", "nipic", "zdmimg", "smzdm", "chinaqking",
             "faiusr", "huitu", "tukuchina", "quanjing", "photophoto")
# 二次元/表情/社交站点优先
GOOD_HOSTS = ("pixiv", "bilibili", "hdslb", "douyin", "weibo", "lofter", "huaban",
              "mfuns", "qiubiaoqing", "giphy", "tenor", "acg", "bcy", "dilidili")


def _host_rank(url):
    host = ""
    try:
        host = urllib.parse.urlsplit(url).netloc.lower()
    except Exception:
        return 9
    if any(b in host for b in BAD_HOSTS):
        return 99
    if any(g in host for g in GOOD_HOSTS):
        return 0
    return 1




def _search_sogou(query, limit=12):
    """搜狗图片（网页版），返回原始图片直链。Bing 被限流时靠它兜底。"""
    url = "https://pic.sogou.com/pics?query=" + urllib.parse.quote(query)
    html = _get(url, referer="https://pic.sogou.com/").decode("utf-8", "ignore")
    raw = re.findall(r'"(?:picUrl|thumbUrl)":"(.*?)"', html)
    out = []
    for u in raw:
        u = u.replace("\\u002F", "/").replace("\\/", "/")
        if not u.startswith("http"):
            continue
        if u not in out:
            out.append(u)
        if len(out) >= limit:
            break
    return out


def _referer_for(url):
    host = ""
    try:
        host = urllib.parse.urlsplit(url).netloc.lower()
    except Exception:
        pass
    if "sogou" in host or "qq.com" in host:
        return "https://pic.sogou.com/"
    return "https://www.bing.com/"


def search(query, limit=12):
    """Bing 图片搜索，返回候选图片直链。"""
    url = "https://www.bing.com/images/search?q=%s&form=HDRSC2&first=1" % urllib.parse.quote(query)
    text = _get(url).decode("utf-8", "ignore")
    urls = re.findall(r'murl&quot;:&quot;(.*?)&quot;', text)
    if not urls:
        urls = re.findall(r'"murl":"(.*?)"', text)
    # 先试搜狗：Bing 对我们这边会限流，返回与查询无关的降级结果
    try:
        sogou = sorted(dict.fromkeys(_search_sogou(query, limit)), key=_host_rank)
    except Exception:
        sogou = []
    urls = sogou + [u for u in urls if u not in sogou]
    urls = sorted(dict.fromkeys(urls), key=_host_rank)
    out = []
    for u in urls:
        u = u.replace("&amp;", "&").strip()
        if not u.startswith("http"):
            continue
        # 图床常在扩展名后面挂参数/变换后缀：
        #   .../x.jpg_wh300.jpg!/fh/300/quality/90、.../x.jpg!list1x.v2
        # 所以只看「? ! # 之前的部分里有没有图片扩展名」，真假交给下载后的魔数校验。
        path = re.split(r"[?#!]", u.lower())[0]
        if not any(ext in path for ext in (".jpg", ".jpeg", ".png", ".gif", ".webp")):
            continue
        if _host_rank(u) >= 99:
            continue
        if u not in out:
            out.append(u)
        if len(out) >= limit:
            break
    return out


def _sniff(data):
    if data[:3] == b"\xff\xd8\xff":
        return "jpg"
    if data[:4] == b"\x89PNG":
        return "png"
    if data[:6] in (b"GIF87a", b"GIF89a"):
        return "gif"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "webp"
    return ""


def _shrink(data, ext, max_bytes=2 * 1024 * 1024, max_side=1280):
    """转格式后可能暴涨（webp→png 能翻好几倍），超过上限就缩放重编码。

    GIF 直接跳过：重编码只会保留第一帧，动图会变成静态图。
    """
    if ext == "gif":
        return data, ext
    if len(data) <= max_bytes:
        return data, ext
    try:
        from PIL import Image
        import io as _io
        img = Image.open(_io.BytesIO(data))
        img.thumbnail((max_side, max_side))
        out = _io.BytesIO()
        if ext == "png" and img.mode in ("RGBA", "LA", "P"):
            img.convert("RGBA").save(out, "PNG", optimize=True)
            new_ext = "png"
        else:
            img.convert("RGB").save(out, "JPEG", quality=85, optimize=True)
            new_ext = "jpg"
        shrunk = out.getvalue()
        return (shrunk, new_ext) if len(shrunk) < len(data) else (data, ext)
    except Exception:
        return data, ext


def fetch(query, dest_dir, limit=12, verify=None, max_tries=4, avoid=None):
    """搜一张能用的图并落盘。返回 (path, source_url)；全失败抛 RuntimeError。"""
    urls = search(query, limit=limit)
    if not urls:
        raise RuntimeError("图源没返回结果（可能被网络拦了）")
    os.makedirs(dest_dir, exist_ok=True)
    errors = []
    tried = 0
    avoid = set(avoid or ())
    seen_avoid = 0
    for u in urls:
        if tried >= max_tries:
            errors.append("试满 %d 张仍不合格" % max_tries)
            break
        try:
            data = _get(u, referer=_referer_for(u))
        except Exception as e:
            errors.append("下载失败 %s" % type(e).__name__)
            continue
        n = len(data)
        if n < MIN_BYTES:
            errors.append("太小 %dB" % n)
            continue
        if n > MAX_BYTES:
            errors.append("太大 %.1fMB" % (n / 1024 / 1024))
            continue
        ext = _sniff(data)
        if not ext:
            errors.append("不是图片")
            continue
        # 内容去重：同一张图不要重复存（以前只把 hash 写进文件名，重复下载照样存两份）
        digest = hashlib.sha1(data).hexdigest()[:16]
        # 「再来一张」时跳过刚发过的：同一个搜索词的第一名永远是同一张，
        # 不去重就变成"换一张还是它"（2026-11-21 21:15 踩到）
        if digest in avoid:
            seen_avoid += 1
            errors.append("刚发过这张")
            continue
        try:
            _same = [n for n in os.listdir(dest_dir) if n.startswith(digest + "_")]
        except Exception:
            _same = []
        if _same:
            _hit = os.path.join(dest_dir, _same[0])
            touch(_hit)
            return _hit, u
        # webp 在微信里会被当成「文件」而不是图片，转成 png
        if ext == "webp":
            try:
                from PIL import Image
                import io as _io
                buf = _io.BytesIO(data)
                img = Image.open(buf).convert("RGBA")
                out = _io.BytesIO()
                img.save(out, "PNG")
                data = out.getvalue()
                ext = "png"
            except Exception:
                pass
        data, ext = _shrink(data, ext)
        path = os.path.join(dest_dir, "%s_%s.%s" % (digest, int(time.time()), ext))
        with open(path, "wb") as f:
            f.write(data)
        tried += 1          # 真实下载并落盘的张数（没 verify 也要算，否则报「试了 0 张」）
        # 让调用方（视觉模型）判断这张是不是真的要的那张，不对就换下一张
        if verify is not None:
            try:
                ok = bool(verify(path))
            except Exception as e:
                errors.append("校验异常 %s" % type(e).__name__)
                ok = True          # 校验不可用时不拦，宁可发出也不要卡死
            if not ok:
                try:
                    os.remove(path)
                except Exception:
                    pass
                errors.append("内容不符")
                continue
        try:
            with open(os.path.join(dest_dir, "_sources.txt"), "a", encoding="utf-8") as f:
                f.write("%s\t%s\t%s\n" % (time.strftime("%Y-%m-%d %H:%M:%S"), digest, u))
        except Exception:
            pass
        return path, u
    if seen_avoid and tried == 0:
        raise RuntimeError("这几张都刚发过了，换个说法或加个词再试")
    raise RuntimeError("试了 %d 张都不合适（%s）" % (tried, "；".join(errors[:3]) or "未知"))

GENERIC = ("表情包", "图", "图片", "壁纸", "表情", "一张")
REQ_RE = re.compile(r"(?:发|来|找|搜|弄)(?:我|给我)?\s*(?:一张|张|一遍|一次|个)?\s*(.{1,24})")

# 明显不是在点图的说法
NOT_A_REQUEST = ("怎么", "为什么", "是不是", "糊", "清楚", "吗", "呢", "吧", "之前", "上次")


def _clean_kw(raw):
    kw = re.split(r"[，。！？!?、,\n]", raw)[0].strip()
    kw = kw.replace("你搜到的", "").replace("搜到的", "").replace("我的", "")
    kw = kw.strip(" 的")
    for tail in ("表情包", "图片", "壁纸", "图"):
        if kw.endswith(tail) and len(kw) > len(tail):
            kw = kw[: -len(tail)].strip(" 的")
            break
    kw = kw.strip(" 的")
    # "来点开心的""发一张你的照片"——这类没有具体主体，搜出来的全是垃圾
    kw = re.sub(r"^(点|些|一点|几个|那种|那种的)", "", kw).strip(" 的")
    if kw in ("自拍", "照片", "你", "本人", "你自己", "你的样子", "你的照片"):
        return ""
    if kw in ("开心", "高兴", "难过", "生气", "委屈", "无聊", "可爱", "萌", "搞笑"):
        return ""          # 这是要库里现成的表情，不是要上网搜
    if len(kw) < 2 or len(kw) > 12:
        return ""
    if kw in GENERIC:
        return ""
    if any(bad in kw for bad in NOT_A_REQUEST):
        return ""
    if any(ch in kw for ch in ("没", "吗", "呢", "？", "?")):
        return ""
    return kw


def detect_request(text):
    """从主人的话里判断「要一张什么图」，认不出返回空串。"""
    t = str(text or "").strip()
    # 「有没有 X 的图」是真心想要图，先单独接住（必须带 图/表情包，避免误伤闲聊）
    m0 = re.search(r"(?:有没有|有)(.{2,12}?)(?:的)?(?:图|图片|表情包)", t)
    if m0:
        kw0 = _clean_kw(m0.group(1))
        if kw0:
            return kw0
    # 其余问句/追问不是要图："找到没""有了吗""哪张？" —— 以前把"找到没"当成要"到没"
    if re.search(r"(没|吗|呢|么|了吧|在哪)\s*[？?]?\s*$", t):
        return ""
    if re.match(r"^(找|搜|看|有)?\s*(到|了|着)?\s*(没|没没|没有|了吗)", t):
        return ""
    m = REQ_RE.search(t)
    if not m:
        return ""
    return _clean_kw(m.group(1))

RETRY_RE = re.compile(r"(再试|再给我发|再发一?遍|再发一?次|再发一?张|重新发|再来一张|换一张|试一下|试下|你搜到的|搜到的)")
DEFAULT_KEYWORD = "鲸鱼娘 表情包"


def detect_action(text):
    """返回 (关键词, 是否重试)。

    关键词非空 = 明确要一张什么图；空且 retry=True = 短句重试（"再试一下""发一遍"）。
    """
    t = str(text or "").strip()
    kw = detect_request(t)
    if kw:
        return kw, False
    if len(t) <= 20 and RETRY_RE.search(t):
        return "", True
    return "", False

# ---------- 先思考：把「主人想要什么图」变成一条能搜到对味图的搜索词 ----------
_QUERY_CACHE = {}
_PLAN_SYS = (
    "你是图片搜索词生成器。根据对方要图的原话，输出**一条**最可能搜到对味图片的中文搜索词。\n"
    "规则：只输出搜索词本身，不要标点、不要解释、不要引号；不超过 20 字；"
    "补上风格词（如 二次元、表情包、插画、可爱）并排除容易搜到手办/商品白底图的歧义词。"
)


def _api_key():
    try:
        import json
        with open(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                              "data", "settings.json"), encoding="utf-8-sig") as f:
            st = json.load(f)
        return str(st.get("apiKey") or ""), str(st.get("baseUrl") or "https://api.deepseek.com")
    except Exception:
        return "", "https://api.deepseek.com"


def plan_query(raw, fallback=""):
    """让模型先想清楚该搜什么；失败就退回关键词。"""
    raw = str(raw or "").strip()
    key = raw[:120]
    if key in _QUERY_CACHE:
        return _QUERY_CACHE[key]
    api_key, base = _api_key()
    if not api_key or not raw:
        return fallback
    try:
        import json
        body = json.dumps({
            "model": "deepseek-flash",
            "messages": [
                {"role": "system", "content": _PLAN_SYS},
                {"role": "user", "content": raw},
            ],
            "max_tokens": 60,
            "temperature": 0.3,
            # 推理模型会把 max_tokens 全花在思考上，content 变成空串（识图那次踩过同一个坑）
            "thinking": {"type": "disabled"},
        }).encode("utf-8")
        req = urllib.request.Request(
            base.rstrip("/") + "/chat/completions",
            data=body,
            headers={"Content-Type": "application/json", "Authorization": "Bearer " + api_key},
        )
        with urllib.request.urlopen(req, timeout=15) as r:
            data = json.loads(r.read().decode("utf-8"))
        q = str(data["choices"][0]["message"]["content"] or "").strip().strip('"').strip()
        if not q:
            body2 = json.dumps({
                "model": "deepseek-flash",
                "messages": [{"role": "system", "content": _PLAN_SYS},
                             {"role": "user", "content": raw}],
                "max_tokens": 400,
                "temperature": 0.3,
                "thinking": {"type": "disabled"},
            }).encode("utf-8")
            req2 = urllib.request.Request(base.rstrip("/") + "/chat/completions", data=body2,
                                          headers={"Content-Type": "application/json",
                                                   "Authorization": "Bearer " + api_key})
            with urllib.request.urlopen(req2, timeout=20) as r2:
                q = str(json.loads(r2.read().decode("utf-8"))["choices"][0]["message"]["content"] or "").strip()
        q = re.split(r"[\n，。！？]", q)[0].strip()
        if 2 <= len(q) <= 24:
            _QUERY_CACHE[key] = q
            return q
    except Exception:
        pass
    return fallback

# ---------- 清理：久不用的搜来的图自动删掉 ----------
KEEP_DAYS = 30
MAX_FILES = 60
PRUNE_INTERVAL = 3600
_last_prune = [0.0]


def _usage_file(dest_dir):
    return os.path.join(dest_dir, "_usage.json")


def _load_usage(dest_dir):
    try:
        import json
        with open(_usage_file(dest_dir), encoding="utf-8") as f:
            d = json.load(f)
        return d if isinstance(d, dict) else {}
    except Exception:
        return {}


def _save_usage(dest_dir, data):
    try:
        import json
        tmp = _usage_file(dest_dir) + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False)
        os.replace(tmp, _usage_file(dest_dir))
    except Exception:
        pass


def touch(path):
    """记一笔「这张图刚用过」。"""
    try:
        d = os.path.dirname(os.path.abspath(path))
        usage = _load_usage(d)
        usage[os.path.basename(path)] = time.time()
        _save_usage(d, usage)
    except Exception:
        pass


def prune(dest_dir, keep_days=KEEP_DAYS, max_files=MAX_FILES, force=False, log=None):
    """删掉久未使用的搜来的图。按「最后使用时间」算，没记录的退回文件时间。

    返回 (删除数量, 剩余数量)。
    """
    now = time.time()
    if not force and now - _last_prune[0] < PRUNE_INTERVAL:
        return 0, None
    _last_prune[0] = now
    try:
        names = [n for n in os.listdir(dest_dir)
                 if not n.startswith("_") and os.path.isfile(os.path.join(dest_dir, n))]
    except Exception:
        return 0, None
    usage = _load_usage(dest_dir)
    ttl = max(1, int(keep_days)) * 86400
    info = []
    for n in names:
        p = os.path.join(dest_dir, n)
        try:
            st = os.stat(p)
        except Exception:
            continue
        last = float(usage.get(n) or st.st_mtime)
        info.append((last, n, st.st_size))
    removed = 0
    # 1) 超过保留期的
    keep = []
    for last, n, size in info:
        if now - last > ttl:
            try:
                os.remove(os.path.join(dest_dir, n))
                usage.pop(n, None)
                removed += 1
            except Exception:
                keep.append((last, n, size))
        else:
            keep.append((last, n, size))
    # 2) 数量超限的，从最旧的开始删
    keep.sort()
    while len(keep) > max(1, int(max_files)):
        last, n, size = keep.pop(0)
        try:
            os.remove(os.path.join(dest_dir, n))
            usage.pop(n, None)
            removed += 1
        except Exception:
            pass
    _save_usage(dest_dir, usage)
    if removed and log:
        try:
            log('清理搜来的图：删除 %d 张，剩 %d 张' % (removed, len(keep)))
        except Exception:
            pass
    return removed, len(keep)

# ---------- 已发清单（落盘，重启后仍记得发过什么）----------
SENT_FILE = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                         "data", "pic-sent.json")
SENT_KEEP_PER_CHAT = 12
SENT_KEEP_DAYS = 7
SENT_KEEP_CHATS = 50
_SENT_CACHE = {"data": None}


def _sent_load():
    if _SENT_CACHE["data"] is not None:
        return _SENT_CACHE["data"]
    try:
        import json
        with open(SENT_FILE, encoding="utf-8") as f:
            d = json.load(f)
        _SENT_CACHE["data"] = d if isinstance(d, dict) else {}
    except Exception:
        _SENT_CACHE["data"] = {}
    return _SENT_CACHE["data"]


def _sent_save(data):
    try:
        import json
        tmp = SENT_FILE + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False)
        os.replace(tmp, SENT_FILE)
        _SENT_CACHE["data"] = data
    except Exception:
        pass


def sent_for(username):
    """这个会话最近发过的图 hash（新→旧）。"""
    d = _sent_load()
    items = d.get(str(username)) or []
    out = []
    now = time.time()
    for it in items:
        if isinstance(it, dict) and it.get("h") and now - float(it.get("t") or 0) < SENT_KEEP_DAYS * 86400:
            out.append(str(it["h"]))
    return out[:SENT_KEEP_PER_CHAT]


def sent_add(username, digest):
    """记一张已发出的图，并顺手清理过期记录。"""
    if not username or not digest:
        return
    d = _sent_load()
    now = time.time()
    items = [it for it in (d.get(str(username)) or [])
             if isinstance(it, dict) and now - float(it.get("t") or 0) < SENT_KEEP_DAYS * 86400
             and it.get("h") != digest]
    items.insert(0, {"h": str(digest), "t": now})
    d[str(username)] = items[:SENT_KEEP_PER_CHAT]
    # 只留最近活跃的若干个会话
    if len(d) > SENT_KEEP_CHATS:
        order = sorted(d.items(), key=lambda kv: max([x.get("t") or 0 for x in kv[1]] or [0]), reverse=True)
        d = dict(order[:SENT_KEEP_CHATS])
    _sent_save(d)
