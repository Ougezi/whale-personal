# -*- coding: utf-8 -*-
"""Bridge runtime mixin: ReceiverMixin."""
import html
import os
import re
import threading

import engine as G

try:
    import document_read as doc_read
except Exception:  # 模块没就位时退回旧行为（文件消息当卡片跳过）
    doc_read = None
try:
    import doc_store
except Exception:
    doc_store = None
try:
    import dsh_agent
except Exception:
    dsh_agent = None
try:
    import douyin_agent
except Exception:
    douyin_agent = None
try:
    import platform_agent
except Exception:
    platform_agent = None
try:
    import image_fetch
except Exception:
    image_fetch = None
try:
    import picture_claim
except Exception:
    picture_claim = None

# ---------------------------------------------------------------- 回复抹除
import re as _scrub_re

_CLAIM_RE = _scrub_re.compile(r"桥接(?:有|给了?)?(?:回执|确认)[^，。！？\n]*|桥接确认(?:送)?到")
# 只在「派/让/交给 + 执行端」且涉及图时才抹；
# 单纯提到「执行端」不算（"执行端的任务完成了，图也发你了" 是真话）
_DELEG_RE = _scrub_re.compile(r"(?:派|让|交给|叫)\s*(?:dsh|DSH|执行端)|派活|派出去", _scrub_re.I)
# 否定语境不抹：「不用派执行端」本身就是对的
_DELEG_NEG = _scrub_re.compile(r"不用|不需要|不必|无需|不是派")
_IMG_RE = _scrub_re.compile(r"图|表情|搜|扒|下载")
_SENT_RE = _scrub_re.compile(r"(?<=[。！？!?\n])")
# 过时说法：搜图早已成功，她还在说"没回音"（18:53 那次就发了正确的图还在说这句）
_STALE_RE = _scrub_re.compile(r"搜图|找图")
_STALE_BAD = _scrub_re.compile(r"没回音|没结果|没收到|卡着|卡住|卡在")
# 过时的「库存告急」：库里明明还有搜来的一类
_STOCK_RE = _scrub_re.compile(r"库存|掏不出|就这么多|没几张|快没了")


def scrub_reply_claims(text):
    """抹掉她编的话：假送达回执、把发图说成派执行端。

    一句话里同时出现「执行端/派活」和「图/搜」就整句丢掉；
    全被丢光时给一句正确说法，别发空气。
    """
    t = str(text or "")
    if not t:
        return t
    t = _CLAIM_RE.sub("", t)
    kept = []
    dropped = dropped_stock = False
    for sent in _SENT_RE.split(t):
        if _DELEG_RE.search(sent) and _IMG_RE.search(sent) and not _DELEG_NEG.search(sent):
            dropped = True
            continue
        if _STALE_RE.search(sent) and _STALE_BAD.search(sent):
            dropped = True
            continue
        if _STOCK_RE.search(sent):
            dropped_stock = True
            continue
        kept.append(sent)
    out = "".join(kept).strip()
    if len(out) < 8:
        if dropped:
            out = "要图我这边直接找，不用派执行端。"
        elif dropped_stock:
            out = "嗯，我再给你找一张。"
    out = _scrub_re.sub(r"[，,、]\s*[。！？!?]", "。", out)
    return _scrub_re.sub(r"\n{2,}", "\n", out).strip()




# 识别一条媒体最多等多久。长截图会拆成 2~3 段、每段一次看图请求（单次请求超时
# 120 秒），所以图片给得宽一些；但必须有上限：这些活都跑在「同一会话串行」的消息
# worker 里，不设上限时任何一次卡住都会让整个会话排到最后一条消息过期。
MEDIA_TIMEOUTS = {'图片': 180.0, '表情': 150.0, '语音': 120.0}
_MEDIA_TIMEOUT_FALLBACK = 120.0


def run_media_with_timeout(recognize, kind, msg, log=None, timeout=None):
    """在守护线程里跑媒体识别，超时就放弃这一条，先把会话放出来。

    识别链路里有几处天然会长时间阻塞：从微信进程内存里反推图片 AES 密钥、
    ffmpeg 转 wxgf、视觉 / 语音接口的单次请求超时。它们一旦卡住，同一个会话
    后面的消息就只能排队 —— 用户看到的是「发了张图 Bot 就死了，重启才好」
    （2026-11-15 16:15 本机日志）。这里只加时间上限，不改识别本身的行为：
    超时按「这条不回话」处理，并把原因写回消息，交给调用方统一记 error 日志。
    """
    limit = MEDIA_TIMEOUTS.get(kind, _MEDIA_TIMEOUT_FALLBACK) if timeout is None else float(timeout)
    box = {}

    def work():
        try:
            box['text'] = recognize()
        except BaseException as exc:  # noqa: BLE001 - 识别失败本来就不回话
            box['err'] = exc

    thread = threading.Thread(target=work, name='media-' + str(kind), daemon=True)
    thread.start()
    thread.join(max(0.1, limit))
    if thread.is_alive():
        reason = '识别超时（超过 %.0f 秒）' % limit
        if isinstance(msg, dict):
            msg['_media_fail'] = reason
        if log:
            log('识别超时（%.0f 秒）：类型=%s 消息id=%s:%s'
                % (limit, kind, (msg or {}).get('shard') or '', (msg or {}).get('local_id')))
        return ''
    if 'err' in box:
        exc = box['err']
        if isinstance(msg, dict):
            msg['_media_fail'] = type(exc).__name__
        if log:
            log('识别异常：类型=%s 消息id=%s:%s 原因=%s'
                % (kind, (msg or {}).get('shard') or '', (msg or {}).get('local_id'),
                   type(exc).__name__))
        return ''
    return box.get('text') or ''


def image_key_note(db, downloader=None):
    """图片密钥能不能离线派生：只输出状态，不碰任何密钥内容。"""
    cfg = None
    try:
        cfg = getattr(db, 'cfg_dword', None)
    except Exception:
        cfg = None
    if not cfg and downloader is not None:
        cfg = getattr(downloader, '_cfg_dword', None)
    cached = False
    try:
        workdir = str(getattr(db, 'workdir', '') or '')
        cached = bool(workdir) and os.path.exists(os.path.join(workdir, 'image_keys.json'))
    except Exception:
        cached = False
    if cfg:
        return 'cfgDword 可用（能离线派生）'
    return 'cfgDword 不可用（只能扫微信进程内存；密钥缓存%s）' % ('有' if cached else '没有')


def image_dir_note(db, path):
    """这张图来自当前账号目录，还是旧目录 / 另一个账号。"""
    raw_current = str(getattr(db, 'account_dir', '') or '')
    if not raw_current or not path:
        return ''
    try:
        current = os.path.normcase(os.path.abspath(raw_current))
        got = os.path.normcase(os.path.abspath(str(path)))
    except Exception:
        return ''
    if not current or not got:
        return ''
    if got == current or got.startswith(current.rstrip('\\/') + os.sep):
        return '当前账号目录'
    return '非当前账号目录（旧目录或别的账号，密钥可能对不上）'


def _nested_quote_text(quoted):
    """被引用的内容本身还是 XML（多层引用）时，往里剥最多两层拿纯文字。"""
    for _ in range(2):
        if quoted.startswith('<') and '<refermsg' in quoted:
            inner = re.search(r'<refermsg>.*?</refermsg>', quoted, re.S)
            if inner:
                content = re.search(r'<content>(.*?)</content>', inner.group(0), re.S)
                if content:
                    quoted = html.unescape(content.group(1)).strip()
                    continue
        break
    return quoted


def parse_quote_content(content):
    """拆出被引用者、原文、新回复和被引用图片的服务器 ID。

    微信的引用回复是 appmsg（57<<32|49，类型名落到「文件/链接/卡片」），正文
    是一条没有 <url> 的 XML，原来的处理找不到链接就把整条丢掉 —— 用户「引用一句
    再回」时机器人像没收到。这里取 <refermsg> 里的昵称和原话，再取出引用者这次
    真正打的字：老版本在最后一个 </msg> 之后，微信 4.x 放在 <title> 里。

    图片 ID 为 '' 表示引用了图片但未提供 ID，为 None 表示普通引用。
    没有完整引用结构或类型不符时返回 None，交给原来的类型分支处理。
    """
    if '<refermsg' not in str(content or ''):
        return None
    content = str(content)
    # 字面标签和不完整 XML 都可能出现在普通正文里，不能仅凭子串判为引用。
    import xml.etree.ElementTree as _et
    end = content.rfind('</msg>')
    if end < 0:
        return None
    try:
        root = _et.fromstring(content[:end + len('</msg>')])
    except _et.ParseError:
        return None
    if root.tag != 'msg':
        return None
    apps = root.findall('appmsg')
    if len(apps) > 1:
        return None
    envelope = apps[0] if apps else root
    references = envelope.findall('refermsg')
    if len(references) != 1:
        return None
    quote_type = envelope.findtext('type')
    if quote_type is not None and quote_type.strip() != '57':
        return None
    quoted_by = quoted = ''
    block = re.search(r'<refermsg>.*?</refermsg>', content, re.S)
    if block:
        body = block.group(0)
        name = re.search(r'<displayname>(.*?)</displayname>', body, re.S)
        said = re.search(r'<content>(.*?)</content>', body, re.S)
        quoted_by = html.unescape(name.group(1)).strip() if name else ''
        quoted = html.unescape(said.group(1)).strip() if said else ''
    quoted = _nested_quote_text(quoted)
    tail = html.unescape(content.rsplit('</msg>', 1)[-1]).strip() if '</msg>' in content else ''
    title = re.search(r'<title>(.*?)</title>', content, re.S)
    reply = tail or (html.unescape(title.group(1)).strip() if title else '')
    reference = references[0]
    image_id = reference.findtext('svrid', '').strip() if reference.findtext('type', '').strip() == '3' else None
    return quoted_by, quoted, reply, image_id


def quote_content_text(quote, image_description=None):
    """检查资格时只用图片占位，识别结果只在提交给内核前放入正文。"""
    if quote is None:
        return None
    quoted_by, quoted, reply, image_id = quote
    if image_id is not None:
        if image_description:
            return '（引用的图片，图里是：%s）%s' % (image_description, reply)
        if image_description is not None:
            return '（引用了一张图片，但这边没取到图，无法确认内容）' + reply
        return '（引用了一张图片）' + reply
    if not quoted and not reply:
        return ''
    if quoted and reply:
        return ('（引用%s「%s」）%s' % (quoted_by or '对方', quoted, reply)).strip()
    if reply:
        return reply
    return ('（引用%s「%s」）' % (quoted_by or '对方', quoted)).strip()


# 主人私聊的“迟到消息”宽限：重启/断线期间的消息不要只补记不回复。
# 群聊/其他人仍按 STALE_AFTER，避免停机后把一堆旧消息全回一遍。
MASTER_LATE_GRACE_SEC = 3 * 3600


def late_grace_sec(username, master=None):
    m = master if master is not None else G.MASTER_WXID
    return MASTER_LATE_GRACE_SEC if (m and username == m) else 0


class ReceiverMixin:

    def _get_media(self):
        """按需创建媒体下载器；图片和表情识别共用一个实例。

        多条消息现在会并发识别图片，所以创建过程要加锁：否则会同时 new 出
        两个 MediaDownloader，各自往同一个缓存目录里落文件。
        """
        with self._media_lock:
            if self._media_box['downloader'] is not None:
                return self._media_box['downloader']
            save_dir = G.os.path.join(G.ROOT, 'data', 'media-cache')
            G.os.makedirs(save_dir, exist_ok=True)
            dl = self.MediaDownloader(self.db, save_dir=save_dir)
            from image_cache import bind_target_probe
            bind_target_probe(dl)
            try:
                from media_key_compat import install_key_scan_guard
                install_key_scan_guard(dl, log=G.log)
                G.log('图片密钥：%s' % image_key_note(self.db, dl))
            except Exception as _e:
                G.log('图片密钥扫描护栏没装上（不影响其它识别）：', repr(_e))
            try:
                from media_fallback import install_media_fallback
                installed = install_media_fallback(dl, self.db, log=G.log, root_names=G.DB_ROOT_NAMES)
                if installed:
                    G.log('图片目录兜底已就位（%d 处补丁）' % installed)
            except Exception as _e:
                G.log('图片目录兜底没装上（默认路径不受影响）：', repr(_e))
            self._media_box['downloader'] = dl
            return dl

    def self_identity_ids(self):
        """所有能代表「自己」的内部 id：真 wxid、账号目录名、目录推出来的 wxid。"""
        ids = set()
        values = [getattr(self, 'me', ''), getattr(self, 'self_wxid', ''),
                  getattr(getattr(self, 'db', None), 'wxid', ''),
                  getattr(getattr(self, 'db', None), 'account', '')]
        try:
            values.append(G.account_wxid(getattr(self.db, 'account', '')))
        except Exception:
            pass
        for value in values:
            value = str(value or '').strip()
            if value:
                ids.add(value)
        return ids

    def self_mention_names(self, chat=''):
        """当前「她」在群里可能被 @ 到的名字。

        人设名 + 别名 + 账号昵称 + 账号备注 + 自己 wxid/账号目录，
        再加群成员表里自己的昵称/备注。缓存 60 秒，避免每条消息都开库；
        配置热重载会主动清缓存。改名后最多 60 秒自动跟上。
        """
        now = G.time.time()
        cache = getattr(self, '_mention_cache', None)
        if cache and cache.get('chat') == chat and now - float(cache.get('ts') or 0) < 60:
            return cache['names']

        info = {}
        try:
            info = self.db.get_self_info() or {}
        except Exception:
            info = {}
        nick = str(info.get('nick_name') or '').strip()
        remark = str(info.get('remark') or '').strip()
        if nick and nick != getattr(self, '_self_nick', ''):
            G.log('当前登录账号昵称已更新：', G.safe_name(nick))
        if nick:
            self._self_nick = nick
        else:
            nick = str(getattr(self, '_self_nick', '') or '').strip()

        persona = (getattr(self, 'cfg', {}) or {}).get('persona') or {}
        aliases = getattr(self, 'aliases', None) or []
        group_names = []
        if str(chat or '').endswith('@chatroom'):
            ids = self.self_identity_ids()
            try:
                for member in self.db.get_group_members(chat) or []:
                    if str(member.get('username') or '') in ids:
                        group_names += [member.get('nick_name'), member.get('remark')]
            except Exception:
                pass

        names = G.mention.build_names(
            persona.get('name'), aliases, nick, remark, group_names,
            sorted(self.self_identity_ids()),
        )
        self._mention_cache = {'chat': chat, 'ts': now, 'names': names}
        if names and names != getattr(self, '_mention_logged', None):
            self._mention_logged = list(names)
            G.log('群聊称呼：%s' % (' / '.join(G.safe_name(x) for x in names[:10])))
        return names

    def is_latest_message(self, username, msg):
        """这条是不是当前会话的最后一条。

        只有是当前最后一条时，才让 WeChatAuto 走 ``quote_msg(target_text=None)`` 的「引用最近
        一条」新路径（UIA 行控件 + 像素重心，图片/表情也能定位）。如果生成回复
        期间又来了新消息，宁可不引用，也不要引用错人。
        """
        try:
            latest = self.db.get_messages(username, limit=1)
        except Exception:
            return False
        if not latest:
            return False
        cur = latest[0]
        return (str(cur.get('local_id')) == str(msg.get('local_id'))
                and str(cur.get('shard') or '') == str(msg.get('shard') or ''))

    def describe_image(self, msg):
        try:
            import base64
            user = msg.get('username') or ''
            lid = msg.get('local_id')
            shard = msg.get('shard')
            if not user or lid is None:
                G.log('图片识别跳过：消息缺会话或消息 id')
                return ''
            path = None
            key_missing = False
            for _attempt in range(4):
                for _tier in ('full', 'best'):
                    # 缩略图通常先落盘。重试窗口内只取清晰档，密钥不可用时直接走兜底。
                    if _tier == 'best' and _attempt < 3 and not key_missing:
                        break
                    try:
                        path = self._get_media().download_image(user, int(lid), tier=_tier, shard=shard)
                    except Exception as _e:
                        G.log('图片下载失败（tier=%s）：%r' % (_tier, _e))
                        path = None
                        # 密钥取不到时再等也不会变：后面的重试只是白等，直接转界面兜底。
                        if '密钥' in str(_e):
                            key_missing = True
                    if path:
                        G.log('图片档位：%s → %d KB' % (_tier, G.os.path.getsize(path) // 1024))
                        _origin = image_dir_note(getattr(self, 'db', None), path)
                        if _origin and _origin != '当前账号目录':
                            G.log('图片来源：%s' % _origin)
                        break
                if path or key_missing:
                    break
                if _attempt < 3:
                    G.log('图片缓存尚未就绪，等待重试（%d/3）' % (_attempt + 1))
                    G.time.sleep((0.5, 1.0, 2.0)[_attempt])
            if key_missing and not path:
                G.log('图片密钥取不到，跳过缓存重试，直接走界面兜底')
            raw = b''
            if path:
                with open(path, 'rb') as f:
                    raw = f.read()
            else:
                G.log('图片读取失败：已重试；请确认接收端微信已下载图片（消息id=%s，分片=%s）' % (lid, shard))
                try:
                    _key_note = image_key_note(getattr(self, 'db', None), self._get_media())
                except Exception:
                    _key_note = '密钥状态未知'
                G.log_throttled('img-keys:' + _key_note,
                                '图片密钥状态：%s；消息id=%s' % (_key_note, lid))
                # 磁盘取图失败后直接读取已核对的微信预览，不重复等待原图落盘。
                fallback = getattr(self, 'image_ui_fallback', None)
                raw = fallback(msg) if callable(fallback) else b''
                if not raw:
                    if isinstance(msg, dict):
                        msg['_media_fail'] = '本地图片解不开，界面兜底也没取到'
                    return ''
            if len(raw) > 8 * 1024 * 1024:
                G.log('图片太大，跳过')
                return ''
            if raw[:4] == b'wxgf':
                try:
                    conv = self._get_media()._wxgf_to_jpg(raw)
                except Exception as _e:
                    conv = None
                    G.log('wxgf 转码异常：', repr(_e))
                if not conv:
                    G.log('这张图是 wxgf/HEVC，本机 ffmpeg 没能转出来；改走界面兜底（请同时检查桥接启动时的 ffmpeg 状态）')
                    fallback = getattr(self, 'image_ui_fallback', None)
                    conv = fallback(msg) if callable(fallback) else b''
                    if not conv:
                        if isinstance(msg, dict):
                            msg['_media_fail'] = 'wxgf 转码失败，界面兜底也没取到'
                        return ''
                raw = conv
                ext = '.jpg'
            elif raw[:8] == b'\x89PNG\r\n\x1a\n':
                ext = '.png'
            elif raw[:3] == b'\xff\xd8\xff':
                ext = '.jpg'
            elif raw[:3] == b'GIF':
                ext = '.gif'
            else:
                ext = G.os.path.splitext(path or '')[1].lower()
                if ext not in ('.jpg', '.jpeg', '.png', '.gif'):
                    G.log('图片格式不认识（%s），跳过' % raw[:4])
                    return ''
            mime = 'image/png' if ext == '.png' else 'image/gif' if ext == '.gif' else 'image/jpeg'
            base = self.bot_url.rsplit('/webhook', 1)[0]
            parts = [raw]
            try:
                from image_tiling import prepare_image
                parts, mime, tile_note = prepare_image(raw)
                if tile_note:
                    G.log(tile_note)
            except Exception as _e:
                G.log('图片预处理跳过（用原图）：', repr(_e))
                parts = [raw]
            texts = []
            failures = []
            for idx, part in enumerate(parts):
                prompt = ''
                if len(parts) > 1:
                    prompt = ('这是一张长截图从上往下的第 %d/%d 段。逐条转写这一段里的文字'
                              '（分清左边对方/右边本人），不要省略。'
                              '如果这一段的确看不清，只回答「这段看不清」，不要逐行写「模糊」。'
                              % (idx + 1, len(parts)))
                try:
                    r = G.LOCAL_HTTP.post(base + '/api/vision', json={'image': base64.b64encode(part).decode(), 'mime': mime, 'prompt': prompt}, timeout=120)
                    data = r.json()
                except Exception as _e:
                    failures.append('第%d段请求失败' % (idx + 1))
                    G.log_throttled('img-req:' + type(_e).__name__, '第 %d 段请求失败：' % (idx + 1), repr(_e))
                    continue
                piece = str(data.get('text') or '').strip()
                if piece:
                    texts.append(piece)
                if not data.get('ok', True):
                    err = str(data.get('error') or '')[:120]
                    failures.append(err or ('第%d段失败' % (idx + 1)))
                    G.log_throttled('img-fail:' + err[:40], '第 %d 段识别失败：%s' % (idx + 1, err))
            text = '\n'.join(texts).strip()
            # 六段都只回「这段看不清」时别复读六遍：合成一句再往下走
            _lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
            if len(_lines) >= 2 and len(set(_lines)) == 1 and len(_lines[0]) <= 20:
                text = _lines[0]
            # 图太糊时模型会用成百上千行「模糊」来交差：这种正文进提示词只会白烧
            # token、还很吵。压成一句实话，让她直接说「看不清」。
            if len(text) > 400 and text.count('模糊') >= 8:
                text = '这张图分辨率太低，逐条文字都辨认不出来（模型大部分只能读成「模糊」）。'
            # 分段越多留的篇幅越大：以前一律截到 1200 字，长截图读完只剩个开头
            limit = 1200 if len(parts) <= 2 else min(3600, 1200 + 500 * len(parts))
            if len(text) > limit:
                text = text[:limit] + '…'
            if not text:
                # 整张图都没读出字：把原因交回去，让她如实说「看不清」，而不是当没看见
                reason = failures[0] if failures else '视觉模型没有返回文字（图可能太小、太糊或比例极端）'
                if isinstance(msg, dict):
                    msg['_media_fail'] = reason
                G.log('图片识别：整张图没有读出内容（%d 段）：%s' % (len(parts), reason))
                return ''
            G.log('图片识别：', G.safe_text(text))
            return text
        except Exception as e:
            if isinstance(msg, dict):
                msg['_media_fail'] = type(e).__name__
            G.log_throttled('img-exc:' + type(e).__name__, '图片识别失败：', repr(e))
            return ''

    def describe_quoted_image(self, username, image_id):
        """只在当前会话内精确匹配原图，再把原图的分片和本地行号交给看图。"""
        if not re.fullmatch(r'-?[0-9]{1,19}', image_id):
            return ''
        server_id = int(image_id)
        if not (-(1 << 63) <= server_id < (1 << 63)) or not server_id:
            return ''

        def find_original(tables):
            return self.db._shard_rows(tables, 'WHERE server_id=? AND local_type=3',
                                       (server_id,), per_shard_limit=2)

        rows = self.db._run_msg_query(username, find_original) or []
        # local_id 会跨分片撞号。缺失分片或找到了多条时，不能猜是哪张图。
        if len(rows) != 1 or not rows[0]['shard'] or not rows[0]['local_id']:
            return ''
        row = rows[0]
        return self.describe_image({'username': username, 'local_id': row['local_id'], 'shard': row['shard']})

    def image_ui_fallback(self, msg):
        """核实当前账号后，在限时子进程内读取目标消息的微信预览。"""
        account = self.ACCOUNT
        hwnd = int(account.get('hwnd') or 0)
        if not hwnd or not account.get('verified'):
            G.log('图片预览兜底跳过 reason=account_unverified')
            return b''
        try:
            import win32gui
            import win32process
            from image_ui_fallback import build_preview_request, read_image_via_ui

            db = self.db
            pid = win32process.GetWindowThreadProcessId(hwnd)[1] if win32gui.IsWindow(hwnd) else 0

            def account_matches():
                current = self.ACCOUNT
                return (pid and self.db is db and current.get('verified')
                        and current.get('hwnd') == hwnd and current.get('pid') in (None, 0, pid)
                        and self.configured_account_dir() in ('', db.account)
                        and win32gui.IsWindow(hwnd)
                        and win32process.GetWindowThreadProcessId(hwnd)[1] == pid)

            if not account_matches() or win32gui.GetForegroundWindow() != hwnd:
                G.log('图片预览兜底跳过 reason=account_or_foreground_changed')
                return b''
            chat_name = self.display_name(msg.get('username') or '')
            request = build_preview_request(db, msg, chat_name, hwnd, pid)
            if request is None:
                G.log('图片预览兜底跳过 reason=message_not_unique')
                return b''

            # 先占发送锁再占界面锁，与朋友圈/发送一致。子进程退出后立即释放。
            if not self.send_lock.acquire(timeout=1.0):
                G.log('图片预览兜底跳过 reason=send_busy')
                return b''
            try:
                if not self.gui_lock.acquire(timeout=1.0):
                    G.log('图片预览兜底跳过 reason=gui_busy')
                    return b''
                try:
                    if not account_matches() or win32gui.GetForegroundWindow() != hwnd:
                        G.log('图片预览兜底跳过 reason=account_or_foreground_changed')
                        return b''
                    raw = read_image_via_ui(request, G.log)
                    if raw and not account_matches():
                        G.log('图片预览兜底丢弃 reason=account_changed')
                        return b''
                    return raw
                finally:
                    self.gui_lock.release()
            finally:
                self.send_lock.release()
        except Exception as exc:
            G.log('图片预览兜底异常 type=%s' % type(exc).__name__)
            return b''

    def describe_emoji(self, msg):
        """表情包 → 文字描述；失败返回空串（调用方跳过，不回话）。"""
        try:
            import base64
            from emoji_vision import load_preview, save_original

            def collect_original(raw, image_format):
                try:
                    save_original(G.os.path.join(G.ROOT, 'data', '收集的表情包'), raw, image_format)
                except OSError as exc:
                    G.log('表情包收集失败 type=%s code=%s status= detail=保存原图失败' % (type(exc).__name__, exc.errno or ''))

            collect = {'on_original': collect_original} if getattr(G, 'STICKER_COLLECT', False) else {}
            preview = None
            for attempt in range(4):
                preview = load_preview(self.db.account_dir, msg.get('content'), allow_network=attempt == 3, **collect)
                if preview:
                    break
                if attempt < 3:
                    G.time.sleep((0.5, 1.0, 2.0)[attempt])
            if not preview:
                G.log('表情包读取失败：本地缓存不可解码，且消息没有可取得的原图')
                return ''
            raw, frames = preview
            prompt = '这是对方发来的表情包。简短描述主体、表情、动作和画面文字，看不清就说明，不要编造。'
            if frames > 1:
                prompt += '从左到右是同一动画的%d个抽样帧，结合它们理解，不要当成不同图片；未展示的动作不要猜。' % frames
            response = G.LOCAL_HTTP.post(self.bot_url.rsplit('/webhook', 1)[0] + '/api/vision', json={'image': base64.b64encode(raw).decode(), 'mime': 'image/png', 'prompt': prompt}, timeout=120)
            data = response.json()
            if not data.get('ok'):
                G.log('表情包识图接口失败：', str(data.get('error') or '未知错误')[:160])
                return ''
            text = str(data.get('text') or '').strip()[:1200]
            G.log('表情包识别（%d帧）：%s' % (frames, G.safe_text(text)))
            return text
        except Exception as exc:
            if isinstance(msg, dict):
                msg['_media_fail'] = type(exc).__name__
            G.log('表情包识别异常：', type(exc).__name__)
            return ''

    def transcribe_voice(self, msg):
        """语音消息 → 文字；失败返回空串。"""
        # 使用本条消息的完整快照，防止并行识别时切换服务商混用地址和 Key。
        voice = G.voice_runtime() if callable(getattr(G, 'voice_runtime', None)) else {
            name: getattr(G, name) for name in ('VOICE_ENABLED', 'VOICE_API_KEY', 'VOICE_MODEL',
                'VOICE_BASE_URL', 'VOICE_TIMEOUT', 'VOICE_MAX_SECONDS')}
        if not voice['VOICE_ENABLED']:
            G.log('语音识别已关闭（voice.enabled=false）')
            return ''
        if voice.get('VOICE_SUPPORTED') is False:
            G.log_throttled('voice-provider-unsupported', '当前聊天接口尚未适配语音识别，请在设置 → API 接入 → 语音（识别）手动选择服务')
            return ''
        if not voice['VOICE_API_KEY']:
            G.log_throttled('voice-key-missing', '语音识别缺少对应服务商的 Key，请在设置 → API 接入配置聊天 Key 或语音专用 Key')
            return ''
        try:
            import io
            import wave
            user = msg.get('username') or ''
            lid = msg.get('local_id')
            shard = msg.get('shard')
            if not user or lid is None:
                G.log('语音识别跳过：消息缺会话或消息 id')
                return ''
            path = self._get_media().download_voice(user, int(lid), shard=shard)
            if not path:
                G.log('语音没落盘（这条微信没缓存到本地），跳过')
                return ''
            try:
                import pysilk
            except Exception:
                G.log('缺少 pysilk，装一下：pip install silk-python')
                return ''
            pcm = io.BytesIO()
            with open(path, 'rb') as f:
                pysilk.decode(f, pcm, G.VOICE_SAMPLE_RATE)
            raw = pcm.getvalue()
            seconds = len(raw) / float(G.VOICE_SAMPLE_RATE * 2)
            if seconds < 0.3:
                G.log('语音太短（%.1fs），跳过' % seconds)
                return ''
            if seconds > voice['VOICE_MAX_SECONDS']:
                G.log('语音太长（%.0fs > %.0fs），跳过' % (seconds, voice['VOICE_MAX_SECONDS']))
                return ''
            wav_path = G.os.path.splitext(path)[0] + '.wav'
            try:
                with wave.open(wav_path, 'wb') as w:
                    w.setnchannels(1)
                    w.setsampwidth(2)
                    w.setframerate(G.VOICE_SAMPLE_RATE)
                    w.writeframes(raw)
                with open(wav_path, 'rb') as f:
                    text = G.asr_transcribe(f.read(), voice['VOICE_API_KEY'], voice['VOICE_MODEL'], voice['VOICE_BASE_URL'], voice['VOICE_TIMEOUT'], voice.get('VOICE_PROVIDER', G.VOICE_PROVIDER))
            finally:
                try:
                    G.os.remove(wav_path)
                except Exception:
                    pass
            text = G.clean_transcript(text)
            G.log('语音识别（%.1fs）：%s' % (seconds, G.safe_text(text) if text else '（空）'))
            return text
        except Exception as e:
            if isinstance(msg, dict):
                msg['_media_fail'] = type(e).__name__
            G.log_throttled('voice-fail:' + type(e).__name__, '语音识别失败：', repr(e))
            return ''

    def ocr_pdf(self, path, doc_name, max_pages=3):
        """扫描件 / 图片型 PDF：渲染前几页交给内核的视觉接口转写。"""
        try:
            from document_read import render_pdf_pages
            pages = render_pdf_pages(path, max_pages=max_pages)
        except Exception as e:
            G.log('扫描件转图失败：', repr(e))
            return ''
        if not pages:
            G.log('扫描件没有渲染出页面')
            return ''
        import base64
        base = self.bot_url.rsplit('/webhook', 1)[0]
        texts = []
        for i, img in enumerate(pages, 1):
            try:
                r = G.LOCAL_HTTP.post(
                    base + '/api/vision',
                    json={'image': base64.b64encode(img).decode(), 'mime': 'image/jpeg',
                          'prompt': '这是一份扫描件/图片型 PDF 的第 %d 页，请逐条转写上面的文字，不要省略；'
                                    '看不清的字写「模糊」，不要编造。' % i},
                    timeout=120)
                data = r.json()
                piece = str(data.get('text') or '').strip()
                if piece:
                    texts.append(piece)
                elif not data.get('ok', True):
                    G.log('扫描件第 %d 页识别失败：%s' % (i, str(data.get('error'))[:80]))
            except Exception as e:
                G.log('扫描件第 %d 页识别异常：%r' % (i, e))
        text = '\n'.join(texts).strip()
        if text:
            G.log('扫描件 OCR：%d 页，共 %d 字' % (len(pages), len(text)))
        return text

    def read_document(self, msg, doc_name):
        """文件消息 → 提取文档正文。下载失败 / 解析失败 / 没文字都返回空串。"""
        user = msg.get('username') or ''
        lid = msg.get('local_id')
        shard = msg.get('shard')
        if not user or lid is None:
            G.log('文档读取跳过：消息缺会话或消息 id')
            return ''
        try:
            import document_read as doc_read_mod
        except Exception:
            if isinstance(msg, dict):
                msg['_media_fail'] = '缺少 document_read 模块'
            return ''
        try:
            # wechatauto 的 download_file 在本机版本上不可用（local_type 打包了高位、
            # packed_info 带 protobuf 控制字节），改用自带的稳健实现。
            from doc_download import download_document
            _size = 0
            _ext = G.os.path.splitext(doc_name or '')[1].lower()
            try:
                _mc = (msg.get('content') or '') if isinstance(msg, dict) else ''
                _m = re.search(r'<totallen>(.*?)</totallen>', _mc, re.S)
                if _m:
                    _size = int(re.sub(r'\D', '', _m.group(1)) or 0)
            except Exception:
                _size = 0
            path, real_name = download_document(
                self.db, self._get_media(), user, int(lid),
                G.os.path.join(G.ROOT, 'data', 'media-cache'), doc_name, _size, _ext, gui=getattr(self, 'gui', None))
            if real_name and not doc_name:
                doc_name = real_name
        except Exception as e:
            if isinstance(msg, dict):
                msg['_media_fail'] = '文件下载失败：%s' % (getattr(e, 'message', None) or str(e) or type(e).__name__)
            G.log_throttled('doc-dl:' + type(e).__name__, '文件下载失败：', repr(e))
            return ''
        if not path:
            if isinstance(msg, dict):
                msg['_media_fail'] = '本地找不到这个文件（微信可能没缓存）'
            G.log('文档文件没落盘（这条微信没缓存到本地），跳过')
            return ''
        try:
            # 下载出的文件名里带真实原名（<user>_<local_id>_<原名>）；title 拿不到时回退用它
            if not doc_name:
                base = G.os.path.basename(path)
                doc_name = base.split('_', 2)[-1] if base.count('_') >= 2 else base
            cfg = None
            try:
                cfg = G.read_config() if callable(getattr(G, 'read_config', None)) else None
            except Exception:
                cfg = None
            # 每段上限（document.maxChars）+ 最多读几段（document.maxChunks）
            base = doc_read_mod.default_max_chars(cfg)
            try:
                max_chunks = int((cfg.get('document') or {}).get('maxChunks') or 6) if isinstance(cfg, dict) else 6
            except Exception:
                max_chunks = 4
            max_chunks = max(1, min(8, max_chunks))
            if isinstance(msg, dict):
                msg['_doc_base'] = base
                msg['_doc_max_chunks'] = max_chunks
            text, note = doc_read_mod.describe_document(
                path, doc_name, base * max_chunks, ocr=lambda p: self.ocr_pdf(p, doc_name), ocr_pages=3)
            if doc_store:
                try:
                    _h = doc_store.hash_text(text)
                    doc_store.save_text(G.ROOT, doc_name, text)   # 留档，便于以后回查
                    if _h and isinstance(msg, dict):
                        msg['_doc_hash'] = _h
                except Exception:
                    pass
            if note:
                G.log('文档读取：', G.safe_name(doc_name), note)
                if isinstance(msg, dict):
                    msg['_doc_note'] = note
            return text
        except Exception as e:
            if isinstance(msg, dict):
                msg['_media_fail'] = '文档解析失败：%s' % (getattr(e, 'message', None) or str(e) or type(e).__name__)
            G.log_throttled('doc-extract:' + type(e).__name__, '文档解析失败：', repr(e))
            return ''

    def _spawn_delegation(self, task, username, sender, force=False, approved=False, audit_id=None):
        """委托放后台线程，别堵住会话 worker。"""
        # 记住最后一次委托：主人说「继续」时直接接着做，不用重述任务
        try:
            if not hasattr(self, '_last_tasks'):
                self._last_tasks = {}
            self._last_tasks[username] = (task, G.time.time())
        except Exception:
            pass
        try:
            import threading as _th
            _t = _th.Thread(target=self.delegate_and_reply, args=(task, username, sender, force, approved, audit_id),
                            name='dsh-delegate', daemon=True)
            _t.start()
        except Exception as e:
            G.log('委托线程启动失败，改为同步：', repr(e))
            self.delegate_and_reply(task, username, sender, force, approved, audit_id)

    def _post_job(self, ops):
        """I-16：委托生命周期镜像到 kernel 的 job.js；失败不影响动作。"""
        try:
            import threading
            base = str(getattr(self, 'bot_url', '')).rsplit('/webhook', 1)[0]
            headers = {'x-whale-bridge': '1'}
            if getattr(self, 'token', ''):
                headers['x-bot-token'] = self.token
            url = base + '/api/actions/jobs'
            seq = list(ops or [])
            def work():
                for payload in seq:
                    try:
                        G.LOCAL_HTTP.post(url, json=payload, headers=headers, timeout=2)
                    except Exception:
                        pass
            threading.Thread(target=work, name='job-mirror', daemon=True).start()
        except Exception:
            pass

    def delegate_and_reply(self, task, username, sender, force=False, approved=False, audit_id=None):
        """跑执行端，把结果交回内核，让她用自己的话转述。"""
        # I-07：委托链统一动作审计
        _audit_t0 = G.time.time()
        _audit_id = audit_id or ('delegation_%d' % int(_audit_t0 * 1000))
        _audit_path = G.os.path.join(G.ROOT, 'data', 'action-audit.jsonl')

        def _audit(action, status, reason='', duration=0, evidence=None):
            try:
                import action_audit
                action_audit.record(source='delegation', task_id=_audit_id, chat=username,
                                    action=action, status=status, risk='R2',
                                    mode='workspace-write', goal=task, reason=reason,
                                    duration_ms=duration, evidence=evidence or [],
                                    path=_audit_path)
            except Exception:
                pass

        if dsh_agent is None:
            _audit('delegation_failed', 'failed', 'no-dsh-agent')
            try:
                self.send_text('我这边没有执行端，做不了。', self.display_name(username), username)
            except Exception:
                pass
            return
        target = self.display_name(username)
        # 先判断执行端能不能做，别先答应再打脸
        try:
            _ok, _why = dsh_agent.can_handle(task, force=force)
        except Exception:
            _ok, _why = True, ''
        if not _ok:
            _audit('delegation_blocked', 'blocked', _why[:120])
            G.log('委托被闸门拦下：', _why[:60])
            # 记住这条：主人说「试一下」时强行跑
            try:
                import delegation_flow as _flow
                _flow.ensure(self)
                _flow.remember(self._blocked_tasks, username, task, G.time.time())
            except Exception:
                pass
            try:
                self.send_text(_why, target, username)
            except Exception:
                pass
            return
        # 大任务先给拆分建议，别一上来就占 12 小时（按「拆小点」的教训）
        try:
            _tip = dsh_agent.split_suggestion(task)
        except Exception:
            _tip = ''
        if _tip and not force:
            _audit('delegation_blocked', 'blocked', 'split-suggestion')
            # 记住这条任务：主人回「直接做」时要能直接跑，而不是再给一次建议
            try:
                import delegation_flow as _flow
                _flow.ensure(self)
                _flow.remember(self._pending_tasks, username, task, G.time.time())
            except Exception:
                pass
            G.log('委托过大，先建议拆分（已记为待执行）：', task[:40])
            try:
                self.send_text(_tip, target, username)
            except Exception:
                pass
            return
        try:
            import delegation_flow as _flow
            _flow.clear(getattr(self, '_pending_tasks', {}), username)
        except Exception:
            pass
        # P0：复用 brain_policy 的路径/凭据/网络边界；写任务硬审批
        try:
            import brain_policy
            write = bool(dsh_agent.needs_write(task))
            mode = 'workspace-write' if write else 'read-only'
            workspace = dsh_agent.pick_cwd(task)
            for _m in re.finditer(r'([A-Za-z]:\\[^\s，,。；;]+)', str(task or '')):
                _p = _m.group(1).rstrip('\\/')
                if os.path.isdir(_p):
                    workspace = os.path.abspath(_p); break
                _parent = os.path.dirname(_p)
                if os.path.isdir(_parent):
                    workspace = os.path.abspath(_parent); break
            _policy = brain_policy.BrainPolicy(os.path.join(G.ROOT, 'data'))
            _v = _policy.check_action(task, workspace, mode)
            if not _v.get('ok'):
                _audit('delegation_policy_blocked', 'blocked', str(_v.get('reason')))
                _reason = str(_v.get('reason'))
                if _reason == 'workspace_not_allowed':
                    try:
                        _roots = '、'.join(getattr(_policy, 'roots', [])[:4])
                    except Exception:
                        _roots = ''
                    self.send_text(
                        '这个委托被边界拦了：workspace_not_allowed（工作区不在允许范围%s）。' % (
                            '：' + _roots if _roots else ''),
                        target, username)
                else:
                    self.send_text('这个委托被边界拦了：%s。' % _reason, target, username)
                return
            risk = _v.get('risk') or ('R2' if write else 'R0')
            if write and not approved:
                import delegation_approval
                if delegation_approval.pending(username):
                    self.send_text('还在等你确认上一条委托，先回复「可以」或「不要」。', target, username)
                    return
                delegation_approval.ask(username, task, sender=sender, workspace=workspace, risk=risk,
                                        send=lambda t: self.send_text(t, target, username), task_id=_audit_id)
                _audit('approval_requested', 'pending_approval', 'risk=' + risk)
                return
            if write and approved:
                _audit('approved', 'approved', 'risk=' + risk)
            _job_ops = [{'op': 'create', 'id': _audit_id, 'risk': risk, 'action': 'delegation', 'goal': task, 'timeoutMs': 150000}]
            if str(risk or '').upper() in ('R2', 'R3'):
                _job_ops.append({'op': 'approve', 'id': _audit_id, 'approver': 'owner'})
            _job_ops.append({'op': 'start', 'id': _audit_id})
            self._post_job(_job_ops)
        except Exception as _e:
            G.log('委托策略/审批检查失败（按原逻辑继续）：', repr(_e))
        _audit('delegation_started', 'running')
        try:
            self.send_text('好，我去弄，弄完跟你说。', target, username)
        except Exception as e:
            G.log('委托确认语发送失败：', repr(e))
        # 重活可能要几分钟：先跑，60 秒还没完就告诉她一声，别让对方干等
        import threading as _th
        _box = {}

        def _work():
            try:
                _box['r'] = dsh_agent.run_task(task, chat=username, sender=sender)
            except Exception as _e:
                _box['r'] = (False, '执行端异常：%r' % _e)
                try:
                    import error_meter
                    error_meter.bump('delegate')
                except Exception:
                    pass

        _t = _th.Thread(target=_work, name='dsh-task', daemon=True)
        _t0 = G.time.time()
        _t.start()
        _first_nudge = int((dsh_agent.config() or {}).get('firstNudgeSeconds') or 60)
        _t.join(max(1, _first_nudge))
        if _t.is_alive():
            try:
                self.send_text('这活有点重，还在跑，再等我一会儿～', target, username)
            except Exception as _e:
                G.log('进度提示没发出去：', repr(_e))
            # 长任务：每 30 分钟报一次进度；满 30 分钟还没结果就暂停汇报、问主人要不要继续
            _limit = int((dsh_agent.config() or {}).get('timeout') or 150)
            _deadline = _t0 + _limit + 5
            _stall_min = float((dsh_agent.config() or {}).get('stallMinutes') or 30)
            _stall_sec = max(5, int(_stall_min * 60))
            _next_report = _t0 + _stall_sec
            _paused = False
            _asked = False
            import delegation_flow as _flow
            _flow.ensure(self)
            while _t.is_alive() and G.time.time() < _deadline:
                _t.join(5)   # 5 秒一轮：既能及时响应「继续」，又不空转
                if not _t.is_alive():
                    break
                _now = G.time.time()
                if _paused:
                    # 主人回「继续」→ 解除暂停，重新开始 30 分钟计时
                    if (getattr(self, '_continue_flag', {}) or {}).pop(username, False):
                        _paused = False
                        # 主人已说继续：之后只报进度，不再反复暂停打扰
                        _asked = True
                        _next_report = _now + _stall_sec
                        try:
                            self._paused_chats.discard(username)
                        except Exception:
                            pass
                    continue
                if _now < _next_report:
                    continue
                _mins = max(1, int((_now - _t0 + 59) / 60))
                try:
                    if not _asked:
                        _asked = True
                        _paused = True
                        self._paused_chats.add(username)
                        self.send_text('这活跑了 %d 分钟还没结果，我先暂停汇报。'
                                       '回「继续」我接着等，说「停掉委托」我就结束它。' % _mins,
                                       target, username)
                        G.log('委托 %d 分钟无结果：暂停并询问主人' % _mins)
                    else:
                        self.send_text('还在跑，已经 %d 分钟了，还没结果。' % _mins,
                                       target, username)
                except Exception:
                    pass
                _next_report = _now + _stall_sec
            try:
                self._paused_chats.discard(username)
                self._continue_flag.pop(username, None)
            except Exception:
                pass
        _res = _box.get('r', (False, '执行端没有返回结果（可能超时后被中断）'))
        ok, text = _res
        try:
            _facts = dsh_agent.facts_block(_res)
        except Exception:
            _facts = ''
        if not ok and '已按你的要求停掉' in str(text):
            _audit('delegation_cancelled', 'cancelled', str(text)[:120], int((G.time.time() - _audit_t0) * 1000))
            G.log('委托已被主人取消，不再重复汇报')
            return
        G.log('执行端返回：%s，%d 字，耗时 %.0f 秒，任务=%s'
              % ('成功' if ok else '失败', len(text), G.time.time() - _t0, task[:40]))
        _audit('delegation_done' if ok else 'delegation_failed',
               'done' if ok else 'failed', str(text)[:160],
               int((G.time.time() - _audit_t0) * 1000), [str(text)[:80]])
        self._post_job([{'op': 'finish', 'id': _audit_id, 'ok': bool(ok), 'value': str(text)[:200], 'reason': '' if ok else str(text)[:200]}])
        _fact_line = ('\n' + _facts) if _facts else ''
        if ok:
            note = ('（这条不是主人说的，是执行端返回的结果——事已经做完，内容如下：\n%s%s）'
                    % (text, _fact_line))
        else:
            note = ('（这条不是主人说的，是执行端返回的结果——事没做成，报的是：%s%s\n'
                    '解释原因时只能用这些事实；不要猜「系统权限」之类——猜错比不说更糟。）'
                    % (text, _fact_line))
        try:
            import time as _t
            payload = {
                'chat_id': username,
                'chat_type': 'group' if username.endswith('@chatroom') else 'private',
                'user_id': sender or 'unknown',
                'senderId': sender or 'unknown',
                'sender_id': sender or 'unknown',
                # 名字写「执行端」而不是主人：她照样会回（id 还是主人），
                # 但上下文和记忆里记的是「执行端回报」，不会被当成主人下达的话。
                'senderName': '执行端',
                'nickname': '执行端',
                'text': note,
                'msg_id': 'dsh-result:%s:%d' % (username, int(_t.time() * 1000)),
                'at_me': True,
                'mentioned_names': [],
                'self_names': [],
                'chat_title': target if username.endswith('@chatroom') else '',
            }
            headers = {'x-whale-bridge': '1'}
            if self.token:
                headers['x-bot-token'] = self.token
            r = G.LOCAL_HTTP.post(self.bot_url, json=payload, headers=headers, timeout=(10, None))
            data = r.json() if r.status_code == 200 else {}
            bubbles = data.get('bubbles') if isinstance(data, dict) else None
            if not isinstance(bubbles, list):
                bubbles = [data.get('reply')] if isinstance(data, dict) else []
            bubbles = [b for b in (bubbles or []) if isinstance(b, str) and b.strip()]
            if not bubbles:
                bubbles = [('弄完了：' + text) if ok else ('没弄成：' + text)]
            for b in bubbles:
                self.send_text(b, target, username)
        except Exception as e:
            G.log('委托结果回传失败：', repr(e))
            try:
                self.send_text(('弄完了，但没连上脑子，原文给你：\n' + text[:600]) if ok
                               else ('没弄成：' + text[:300]), target, username)
            except Exception:
                pass

    def _spawn_douyin(self, task, username, sender):
        """她要看抖音：后台跑 sidecar，别堵会话。"""
        if douyin_agent is None:
            G.log('抖音模块没加载，跳过')
            return
        try:
            import threading as _th
            _t = _th.Thread(target=self._run_douyin, args=(task, username, sender),
                            name='douyin-watch', daemon=True)
            _t.start()
        except Exception as e:
            G.log('抖音线程启动失败，改为同步：', repr(e))
            self._run_douyin(task, username, sender)

    def _spawn_platform(self, spec, username, sender):
        """后台跑 GitHub/B站只读查询，别堵会话。"""
        if platform_agent is None or not platform_agent.enabled():
            G.log('平台调用未开启，跳过')
            return
        try:
            import threading as _th
            _t = _th.Thread(target=self._run_platform, args=(spec, username, sender),
                            name='platform-query', daemon=True)
            _t.start()
        except Exception as e:
            G.log('平台线程启动失败，改为同步：', repr(e))
            self._run_platform(spec, username, sender)

    def _run_platform(self, spec, username, sender):
        """跑一条平台只读查询，把事实作为「执行端回报」交给内核。"""
        target = self.display_name(username)
        try:
            _t0 = G.time.time()
            ok, text = platform_agent.run(spec)
            G.log('平台返回：%s，%d 字，耗时 %.0f 秒，任务=%s'
                  % ('成功' if ok else '失败', len(text), G.time.time() - _t0, str(spec)[:40]))
        except Exception as e:
            ok, text = False, '平台链路异常：%r' % e
        if ok:
            note = ('（这条不是主人说的，是执行端回报——真的查了平台，事实如下：\\n%s\\n'
                    '用自己的话讲给主人听：挑重点说，别整段复述；没查成要说清卡在哪，别编。）'
                    % text)
        else:
            note = ('（这条不是主人说的，是执行端回报——这轮没查成：%s\\n'
                    '照实说，别编看到了什么。）' % text)
        self._post_note(note, username, sender, target)

    def _run_douyin(self, task, username, sender):
        """跑一轮抖音，把事实作为「执行端回报」交给内核，让她自己说。"""
        target = self.display_name(username)
        try:
            _t0 = G.time.time()
            ok, text = douyin_agent.run(task)
            G.log('抖音返回：%s，%d 字，耗时 %.0f 秒，任务=%s'
                  % ('成功' if ok else '失败', len(text), G.time.time() - _t0, str(task)[:40]))
        except Exception as e:
            ok, text = False, '抖音链路异常：%r' % e
        if ok:
            note = ('（这条不是主人说的，是执行端回报——真的去刷了抖音，事实如下：\n%s\n'
                    '用自己的话讲给主人听：挑 2~3 条说，别整段复述；没刷成要说清卡在哪，别编。）'
                    % text)
        else:
            note = ('（这条不是主人说的，是执行端回报——这轮没刷成：%s\n'
                    '照实说，别编看过什么。）' % text)
        self._post_note(note, username, sender, target)

    def _post_note(self, note, username, sender, target):
        """把一条「执行端回报」交给内核，再把她的回复发出去。"""
        try:
            import time as _t
            payload = {
                'chat_id': username,
                'chat_type': 'group' if username.endswith('@chatroom') else 'private',
                'user_id': sender or 'unknown',
                'senderId': sender or 'unknown',
                'sender_id': sender or 'unknown',
                'senderName': '执行端',
                'nickname': '执行端',
                'text': note,
                'msg_id': 'dy-result:%s:%d' % (username, int(_t.time() * 1000)),
                'at_me': True,
                'mentioned_names': [],
                'self_names': [],
                'chat_title': target if username.endswith('@chatroom') else '',
            }
            headers = {'x-whale-bridge': '1'}
            if self.token:
                headers['x-bot-token'] = self.token
            r = G.LOCAL_HTTP.post(self.bot_url, json=payload, headers=headers, timeout=(10, None))
            data = r.json() if r.status_code == 200 else {}
            bubbles = data.get('bubbles') if isinstance(data, dict) else None
            if not isinstance(bubbles, list):
                bubbles = [data.get('reply')] if isinstance(data, dict) else []
            bubbles = [b for b in (bubbles or []) if isinstance(b, str) and b.strip()]
            if not bubbles:
                bubbles = ['刷完了，但没连上脑子，你自己看：\n' + note[:400]]
            for b in bubbles:
                self.send_text(b, target, username)
        except Exception as e:
            G.log('抖音结果回传失败：', repr(e))
            try:
                self.send_text('刷完了，但没连上脑子，原文给你：\n' + note[:600], target, username)
            except Exception:
                pass

    def _spawn_picture(self, keyword, username, force=False, raw=''):
        """找图放后台线程：下载要几秒，别堵住会话。"""
        try:
            import threading as _th
            _t = _th.Thread(target=self.send_searched_picture, args=(keyword, username, force, raw),
                            name='pic-fetch', daemon=True)
            _t.start()
        except Exception as e:
            G.log('找图线程启动失败，改为同步：', repr(e))
            self.send_searched_picture(keyword, username, force, raw)

    def send_local_image(self, path, chat_display_name, chat_username=''):
        """把一张本地图片当表情发出去。

        不走内核的表情任务队列（那条要求 job_id + generation，我们拿不到），
        但保留其余安全检查：发送策略、账号校验、精确会话、窗口前台化。
        """
        if not hasattr(G, 'guarded_sticker_send'):
            return G.sticker_result('failed', 'transport unavailable')
        with self.send_lock, G._SendStateScope(len(str(path or ''))):
            try:
                if not self.account_send_allowed('表情包'):
                    return G.sticker_result('failed', 'send policy rejected')
            except Exception:
                return G.sticker_result('failed', 'send policy unavailable')
            if not self.ACCOUNT.get('verified') or not self.wechat_window_alive():
                return G.sticker_result('failed', 'target account window could not be verified')
            hwnd = int(self.ACCOUNT.get('hwnd') or 0)
            snap = None
            desktop = None
            try:
                desktop = G.WindowsDesktop()
                if not desktop.foreground(hwnd):
                    snap = self.snapshot_win_state()
                    from moments_window import activate_verified_window

                    def activation_allowed():
                        return (bool(self.ACCOUNT.get('verified'))
                                and int(self.ACCOUNT.get('hwnd') or 0) == hwnd)

                    evidence = {}
                    ready = activate_verified_window(
                        self, hwnd, int(self.ACCOUNT.get('pid') or 0), activation_allowed,
                        pause=G.time.sleep, probe=evidence.update)
                    if not ready or not desktop.foreground(hwnd):
                        return G.sticker_result('failed', 'could not bring the WeChat window to the foreground')
            except Exception:
                return G.sticker_result('failed', 'foreground safety checks are unavailable')
            try:
                with self.gui_lock:
                    current_gui = self.gui
                    if current_gui is None:
                        return G.sticker_result('failed', 'window driver is not ready')
                    canonical, aliases = G.resolve_sticker_target(self.db, chat_display_name, chat_username)
                    if not self.send_policy_allows(canonical, chat_display_name):
                        return G.sticker_result('cancelled', 'chat is blocked by the send policy')
                    if not current_gui.use_window(hwnd) or int(current_gui.main_hwnd) != hwnd:
                        return G.sticker_result('failed', 'unable to bind the verified account window')
                    uia = getattr(current_gui, '_uia', None)
                    if uia is None:
                        uia = current_gui._get_uia()
                    if uia is None:
                        return G.sticker_result('failed', 'UIA target proof is unavailable')
                    search_keys = [chat_display_name] + [a for a in aliases if a and a != chat_display_name]
                    try:
                        if not G.sticker_alias_match(uia.current_chat(), aliases):
                            uia.open_chat(search_keys)
                            for _ in range(8):
                                G.time.sleep(0.25)
                                if G.sticker_alias_match(uia.current_chat(), aliases):
                                    break
                    except Exception:
                        return G.sticker_result('failed', 'exact target is not open in the pinned window')
                    if not G.sticker_alias_match(uia.current_chat(), aliases):
                        return G.sticker_result('failed', 'exact target is not open in the pinned window')
                    current = self.sticker_config_now()
                    if current is None:
                        return G.sticker_result('cancelled', 'stickers are disabled')
                    directory = (current.get('sticker') or {}).get('dir') or 'data/stickers'
                    directory = directory if G.os.path.isabs(directory) else G.os.path.join(G.ROOT, directory)

                    def gate():
                        return (bool(self.ACCOUNT.get('verified'))
                                and int(self.ACCOUNT.get('hwnd') or 0) == hwnd
                                and self.sticker_config_now() is not None)

                    outcome = G.guarded_sticker_send(
                        current_gui, uia, hwnd, aliases, path, directory, self.db, canonical,
                        gate=gate, account_valid=lambda: True,
                        activity_allowed=lambda: self.sticker_activity_allowed(canonical),
                        desktop=desktop)
                    if not isinstance(outcome, dict):
                        return G.sticker_result('failed', 'unknown transport result')
                    return outcome
            finally:
                if snap and desktop is not None:
                    try:
                        if desktop.foreground(hwnd):
                            self.restore_win_state(snap)
                    except Exception:
                        pass

    def _remember_picture(self, keyword, ok, err=''):
        """把发图的真实结果写进她的长期记忆。

        她看不见桥接内部，只能靠猜；猜错的话又会被 episode 摘进记忆，越滚越歪。
        这里用同一个 key 反复写，新的直接取代旧的（不堆条数）。
        """
        try:
            if not G.MASTER_WXID:
                return
            _k = '_pic_mem_' + str(keyword)[:12]
            _now = G.time.time()
            if _now - float(getattr(self, _k, 0) or 0) < 3 * 3600:
                return                      # 同一个词 3 小时内只记一次
            setattr(self, _k, _now)
            if ok:
                # 用独立槽位：能力事实由维护脚本管，这里只记「最近一次」，
                # 同一个 key 每次覆盖自己，不会和能力事实打架。
                text = '最近一次搜图发图成功：%s（%s）。' % (str(keyword)[:20], G.time.strftime('%m-%d %H:%M'))
            else:
                text = '最近一次搜图发图失败：%s（%s）：%s。失败不等于没能力。' % (
                    str(keyword)[:20], G.time.strftime('%m-%d %H:%M'), str(err)[:30])
            base = self.bot_url.rsplit('/webhook', 1)[0]
            r = G.LOCAL_HTTP.post(base + '/api/memory/note', json={
                'chat': 'wechat:u:' + str(G.MASTER_WXID),
                'uid': str(G.MASTER_WXID),
                'text': text,
                'key': '搜图最近',
                'kind': 'fact',
                'confidence': 0.99,
            }, timeout=10)
            G.log('写记忆：%s → %s' % (text[:28], r.status_code))
        except Exception as e:
            G.log('写记忆失败（不影响发图）：', repr(e))

    def _verify_image(self, path, want):
        """让视觉模型判断这张图是不是主人要的；判断不了就当通过。"""
        try:
            import base64
            with open(path, 'rb') as f:
                raw = f.read()
            ext = G.os.path.splitext(path)[1].lower().lstrip('.') or 'jpeg'
            mime = {'jpg': 'image/jpeg', 'jpeg': 'image/jpeg', 'png': 'image/png',
                    'gif': 'image/gif', 'webp': 'image/webp'}.get(ext, 'image/jpeg')
            base = self.bot_url.rsplit('/webhook', 1)[0]
            # 判「风格对不对」比判「长得一模一样」实用得多：
            # 发图场景要的是二次元/卡通/表情包，不要真实照片、商品白底图、海报广告。
            # 判「和用户想要的相不相关」，不要判风格：
            # 要小猫就该给真猫照片，要鲸鱼娘才该给二次元图——风格由搜索词保证，这里只管相关性。
            prompt = ('用户想要一张关于「%s」的图片。这张图和它相关吗？\n'
                      '如果完全不是（要猫却给风景、要动漫人物却给商品图/海报），回答「否」；相关就回答「是」。\n'
                      '只回答「是」或「否」，再补一句图里是什么。' % (want or '这张图'))
            r = G.LOCAL_HTTP.post(base + '/api/vision',
                                  json={'image': base64.b64encode(raw).decode(), 'mime': mime,
                                        'prompt': prompt},
                                  timeout=90)
            text = str((r.json() or {}).get('text') or '').strip()
            if not text:
                return True
            G.log('图片校验：', text[:60])
            # 只认「否」开头会漏判：「不是…」「不符合」「不太像」都会被当成通过
            _t = text.lstrip()
            if _t.startswith(('是', '对', '符合', '可以', '相关', '能')):
                return True
            return not _t.startswith(('否', '不', '没', '错', '无关', '无', '非'))
        except Exception as e:
            G.log('图片校验不可用，放行：', repr(e))
            return True

    def send_searched_picture(self, keyword, username, force=False, raw=''):
        """按关键词搜一张图，存进表情库，再用表情通道发出去。"""
        if image_fetch is None:
            return
        target = self.display_name(username)
        _now = G.time.time()
        # 冷却只防「同一个词连点」，不同关键词一律放行。
        # 以前是全局 30 秒，把用户真实的新请求静默吞掉了（18:39:58 小猫那次）。
        _key = '_pic_last_%s_%s' % (str(username), str(keyword or raw)[:12])
        if not force and _now - float(getattr(self, _key, 0) or 0) < 8:
            G.log('同一个词刚找过，本次跳过（8 秒内重复）：', str(keyword or raw)[:20])
            return
        setattr(self, _key, _now)
        dest = G.os.path.join(G.ROOT, 'data', 'stickers', '搜来的')
        # 顺手清理：久不用的搜来的图删掉（每小时最多跑一次）
        try:
            _keep, _max = image_fetch.KEEP_DAYS, image_fetch.MAX_FILES
            try:
                _pic = (G.read_config() or {}).get('picture') or {}
                _keep = int(_pic.get('keepDays') or _keep)
                _max = int(_pic.get('maxFiles') or _max)
            except Exception:
                pass
            image_fetch.prune(dest, keep_days=_keep, max_files=_max, log=G.log)
        except Exception as _e:
            G.log('清理搜来的图失败：', repr(_e))
        # 先思考：把「主人想要什么」变成一条能搜到对味图的搜索词
        _query = keyword
        try:
            _q = image_fetch.plan_query(raw or keyword, fallback=keyword)
            if _q:
                _query = _q
            G.log('思考搜索词：', '%s → %s' % (keyword or raw[:16], _query))
        except Exception as e:
            G.log('思考搜索词失败，用原词：', repr(e))
        # 这个会话最近发过哪些图：重试时跳过，避免"换一张还是它"（落盘，重启也记得）
        _sent = image_fetch.sent_for(username)
        try:
            path, url = image_fetch.fetch(
                _query, dest, max_tries=8 if _sent else 4, avoid=set(_sent),
                verify=lambda p: self._verify_image(p, raw or keyword or _query))
        except Exception as e:
            # 失败原因只进日志，绝不能让“试了 N 张/内容不符”这种内部话术发到聊天里
            G.log('找图失败：', repr(e))
            try:
                self.send_text(image_fetch.FAIL_REPLY, target, username)
            except Exception:
                pass
            return
        G.log('找到图：%s ← %s' % (G.os.path.basename(path), str(url)[:90]))
        ok = False
        res = {}
        _digest = G.os.path.basename(path).split('_')[0]
        try:
            # 注意：send_sticker 返回的是 dict（{'status': ...}），不是布尔；
            # 而且它要求内核表情队列的 job_id，我们拿不到，所以走 send_local_image。
            res = self.send_local_image(path, target, username)
            ok = isinstance(res, dict) and res.get('status') == 'confirmed'
            if not ok:
                G.log('发图未确认：', str(res)[:140])
        except Exception as e:
            G.log('发图异常：', repr(e))
        if ok:
            try:
                image_fetch.touch(path)   # 记一笔「用过」，清理时按这个算
            except Exception:
                pass
            try:
                image_fetch.sent_add(username, _digest)
            except Exception:
                pass
        try:
            self._remember_picture(keyword or _query, ok, '' if ok else str(res)[:60])
        except Exception as _e:
            G.log('记忆写入调用失败（忽略）：', repr(_e))
        if not ok:
            G.log('发图失败，退回文字说明')
            try:
                self.send_text('图找到了但没发出去，可能微信窗口状态不对，回头再试。', target, username)
            except Exception:
                pass

    def deliver_doc_chunks(self, chunks, doc_name, target, username, sender, nickname, doc_ts=0):
        """分次阅读：把第 2..N 段依次投给内核，并把她的回复发回微信。

        每段都作为一条新消息进入同一会话，历史里已经有上一段和她的回复，
        所以模型能顺着上文继续读（这就是「衔接上一次阅读」）。
        """
        total = len(chunks) + 1
        is_group = (username or '').endswith('@chatroom')
        for idx, chunk in enumerate(chunks, start=2):
            try:
                # 用户已经发来新消息 → 停止剩余分段，别让分段回复和她的新消息交错刷屏
                if doc_ts:
                    try:
                        # 只认「对方发的新消息」：她自己刚发出去的分段回复 sender_id=2，
                        # 不能算插话，否则第 2 段之后就会误停。
                        latest = None
                        for m in self.db.get_messages(username, limit=6):
                            if str(m.get('sender_id')) != '2':
                                latest = m
                                break
                        if latest and float(latest.get('create_time') or 0) > float(doc_ts):
                            G.log('分次阅读：检测到你插话了，停止剩余 %d 段' % (total - idx + 1))
                            return
                    except Exception:
                        pass
                if not G.rate_guard(username):
                    G.log('分次阅读：这一分钟回复太多了，先停在第 %d 段' % idx)
                    return
                G.time.sleep(1.2)      # 等上一轮回复先落库，衔接才自然
                body = ('（同一份文档「%s」第 %d/%d 段，接着上一段继续看：\n%s）'
                        % (doc_name, idx, total, chunk))
                payload = {
                    'chat_id': username,
                    'chat_type': 'group' if is_group else 'private',
                    'user_id': sender or 'unknown',
                    'senderId': sender or 'unknown',
                    'sender_id': sender or 'unknown',
                    'senderName': nickname,
                    'nickname': nickname,
                    'text': body,
                    'msg_id': 'doc-chunk:%s:%d' % (username, idx),
                    # 分段是「同一轮被点名的对话」的继续：群聊里必须算 addressed，
                    # 否则内核按「没叫我」直接忽略，每段都沉默。
                    'at_me': True,
                    'mentioned_names': [],
                    'self_names': [],
                    'chat_title': self.display_name(username) if is_group else '',
                }
                headers = {'x-whale-bridge': '1'}
                if self.token:
                    headers['x-bot-token'] = self.token
                r = G.LOCAL_HTTP.post(self.bot_url, json=payload, headers=headers, timeout=(10, None))
                if r.status_code != 200:
                    G.log('分次阅读：第 %d 段提交失败（HTTP %s）' % (idx, r.status_code))
                    return
                data = r.json()
                if not isinstance(data, dict) or data.get('ok') is not True:
                    G.log('分次阅读：第 %d 段返回异常，停止后续段' % idx)
                    return
                bubbles = data.get('bubbles')
                if not isinstance(bubbles, list):
                    bubbles = [data.get('reply')]
                bubbles = [b for b in (bubbles or []) if isinstance(b, str) and b.strip()]
                if not bubbles:
                    G.log('分次阅读：第 %d 段没有回复，继续下一段' % idx)
                    continue
                for line in bubbles:
                    if not self.send_text(line, target, username):
                        G.log('分次阅读：第 %d 段发送失败，停止' % idx)
                        return
                    G.time.sleep(0.6)
                G.log('分次阅读：第 %d/%d 段已读并回复' % (idx, total))
            except Exception as e:
                G.log('分次阅读：第 %d 段异常 %r' % (idx, e))
                return

    def on_message_inner(self, msg, listener):

        def media_failed(kind):
            """识别失败补一条能把「哪条、谁的、为什么没回」对上的 error 日志。

            以前失败只在识别函数里留零散日志（连消息 id 都没有），事后完全没法回答
            「这条消息她为什么没回」。节流 key 带消息 id：同一条反复失败只记一次，
            别的消息照常各记一条，不会被节流误吞。图片失败不再直接沉默，会把
            「没取到图」的说明交给模型回一句（见下面的占位文本）。
            """
            msg_id = '%s:%s:%s' % (username, msg.get('shard') or '', msg.get('local_id'))
            try:
                chat = self.display_name(username)
            except Exception:
                chat = username
            sender = msg.get('sender_username') or ''
            try:
                who = self.db.get_nickname(sender) or ''
            except Exception:
                who = ''
            if not who:
                who = '群友' if username.endswith('@chatroom') else '微信好友'
            reason = msg.get('_media_fail') or '空描述（识别结果为空）'
            G.log_throttled('media-fail:%s:%s' % (msg_id, kind), '识别失败：会话=%s 发送者=%s 类型=%s 消息id=%s 原因=%s' % (G.safe_id(chat), G.safe_name(who), kind, msg_id, reason), emit=G.log_error)

        def skipped(reason):
            """每条没处理的消息都留痕：排查「她为什么没回」不能只靠猜。

            同一个会话同一种原因 60 秒内只打一行（并给出被折叠的条数），
            正常聊天不会被刷屏，出问题时又能看到到底卡在哪一步。
            """
            G.log_throttled(
                'msg-skip:%s:%s' % (reason, msg.get('username') or ''),
                '消息未处理：%s；会话=%s 消息id=%s:%s:%s'
                % (reason, G.safe_id(msg.get('username') or ''),
                   msg.get('username') or '', msg.get('shard') or '', msg.get('local_id')),
                ttl=60,
            )

        try:
            username = msg.get('username') or ''
            if not username:
                skipped('消息缺少会话标识')
                return
            sender = msg.get('sender_username') or ''
            if sender == self.me:
                skipped('自己发出的消息')
                return
            mtype = msg.get('type') or ''
            content = G.fix_garbled((msg.get('content') or '').strip())
            media_placeholder = False
            is_emoji = mtype in ('表情', '动画表情') or (mtype == '图片' and '<emoji' in content)
            if is_emoji:
                desc = run_media_with_timeout(lambda: self.describe_emoji(msg), '表情', msg, G.log)
                if not desc:
                    media_failed('表情')
                    return
                content = '（对方发了一个表情包，画面是：%s）' % desc
            elif mtype == '图片':
                desc = run_media_with_timeout(lambda: self.describe_image(msg), '图片', msg, G.log)
                if not desc:
                    # 取不到图就装没看见，用户只会觉得「又卡死了」。改成让她自然地回一句：
                    # 明确禁止编造画面，只允许问一句 / 让对方再发。
                    media_failed('图片')
                    content = ('（对方发了一张图片，但这边没取到、也看不清。'
                               '不要编造图里的内容；可以自然地回一句，比如问对方图怎么了、'
                               '或让对方再发一次 / 说说图里是什么）')
                    media_placeholder = True
                else:
                    content = '（对方发了一张图片，图里是：%s）' % desc
            if mtype == '语音':
                said = run_media_with_timeout(lambda: self.transcribe_voice(msg), '语音', msg, G.log)
                if not said:
                    G.log('语音没识别出内容，先不说话')
                    media_failed('语音')
                    return
                content = '（对方发了一条语音，自动转写可能有错字/同音字，按上下文理解，不要顺着怪词编：%s）' % said
            # 引用回复：微信存的是 appmsg XML（类型名落到「文件/链接/卡片」），
            # 委托执行：主人私聊里以「动手：」开头，就交给 DSH headless 真去做。
            if mtype == '文本' and not username.endswith('@chatroom') and dsh_agent:
                _task = dsh_agent.parse_task(content)
                _who = msg.get('sender_username') or ''
                if _task and G.MASTER_WXID and _who == G.MASTER_WXID:
                    G.log('收到委托，转执行端：', _task[:60])
                    self._spawn_delegation(_task, username, _who)
                    return

            # 取消/查询委托：主人私聊里的短命令，桥接直接处理，不走内核
            if mtype == '文本' and not username.endswith('@chatroom') and dsh_agent:
                _who4 = msg.get('sender_username') or ''
                _cmd = str(content or '').strip()
                if G.MASTER_WXID and _who4 == G.MASTER_WXID:
                    import re as _rec
                    import commands as _cmd_pat
                    if _cmd_pat.CANCEL.search(_cmd):
                        _n = dsh_agent.cancel_all()
                        try:
                            self._paused_chats.discard(username)
                            self._continue_flag.pop(username, None)
                        except Exception:
                            pass
                        G.log('主人取消委托：停掉 %d 个' % _n)
                        try:
                            self.send_text(('已停掉 %d 个委托。' % _n) if _n else '现在没有在跑的委托。',
                                           self.display_name(username), username)
                        except Exception:
                            pass
                        return
                    if _cmd_pat.TRY.search(_cmd):
                        _bk = (getattr(self, '_blocked_tasks', {}) or {}).get(username)
                        if _bk and (G.time.time() - _bk[1]) < 900:
                            _btask = _bk[0]
                            try:
                                self._blocked_tasks.pop(username, None)
                            except Exception:
                                pass
                            G.log('主人要求强行尝试：', _btask[:40])
                            try:
                                self.send_text('好，试一次。不行我就直说。',
                                               self.display_name(username), username)
                            except Exception:
                                pass
                            self._spawn_delegation(_btask, username, _who4, force=True)
                        else:
                            try:
                                self.send_text('没有待试的任务了，把要做的事再说一遍？',
                                               self.display_name(username), username)
                            except Exception:
                                pass
                        return
                    if _cmd_pat.CONTINUE.search(_cmd):
                        # 暂停等待中：只是放行，不重开任务
                        if username in (getattr(self, '_paused_chats', set()) or set()):
                            try:
                                if not hasattr(self, '_continue_flag'):
                                    self._continue_flag = {}
                                self._continue_flag[username] = True
                            except Exception:
                                pass
                            try:
                                self.send_text('好，接着等。', self.display_name(username), username)
                            except Exception:
                                pass
                            return
                        # 「继续」不是新任务：接着上一次委托往下做（跳过拆分闸门）
                        _last = (getattr(self, '_last_tasks', {}) or {}).get(username)
                        if _last and (G.time.time() - _last[1]) < 3600:
                            _task0 = _last[0]
                            try:
                                self.send_text('好，接着上次的往下做。', self.display_name(username), username)
                            except Exception:
                                pass
                            G.log('主人要求继续上一次委托：', _task0[:40])
                            self._spawn_delegation(_task0 + '\n（接着上一轮继续：上次没做完的部分继续做，做完就停。）',
                                                   username, _who4, force=True)
                        else:
                            try:
                                self.send_text('上一次的委托太久以前了，再说一次要做啥？',
                                               self.display_name(username), username)
                            except Exception:
                                pass
                        return
                    if _cmd_pat.DIRECT.search(_cmd):
                        # 上一轮被拆分闸门拦下的任务，主人说「直接做」就一次跑完
                        _pend = (getattr(self, '_pending_tasks', {}) or {}).get(username)
                        if _pend and (G.time.time() - _pend[1]) < 900:
                            _ptask = _pend[0]
                            try:
                                self._pending_tasks.pop(username, None)
                            except Exception:
                                pass
                            G.log('主人要求直接做，跳过拆分建议：', _ptask[:40])
                            try:
                                self.send_text('好，一次做完。', self.display_name(username), username)
                            except Exception:
                                pass
                            self._spawn_delegation(_ptask, username, _who4, force=True)
                        else:
                            try:
                                self.send_text('没有待执行的委托了，把要做的事再说一遍？',
                                               self.display_name(username), username)
                            except Exception:
                                pass
                        return
                    if _cmd_pat.STATUS.search(_cmd):
                        try:
                            self.send_text('现在有 %d 个委托在跑（并发上限 %d）。'
                                           % (dsh_agent.running(),
                                              int((dsh_agent.config() or {}).get('maxConcurrent') or 1)),
                                           self.display_name(username), username)
                        except Exception:
                            pass
                        return

            # 主人直接要图：认出关键词就去找；短句重试（"再试一下"）复用上次关键词
            if mtype == '文本' and not username.endswith('@chatroom') and image_fetch:
                _kw, _retry = image_fetch.detect_action(content)
                _who2 = msg.get('sender_username') or ''
                if G.MASTER_WXID and _who2 == G.MASTER_WXID and (_kw or _retry):
                    if _kw:
                        setattr(self, '_pic_kw_' + str(username), _kw)
                        G.log('主人要图：', _kw)
                        self._spawn_picture(_kw, username, raw=content)
                    else:
                        _last = getattr(self, '_pic_kw_' + str(username), '') or image_fetch.DEFAULT_KEYWORD
                        G.log('主人重试找图：', _last)
                        self._spawn_picture(_last, username, force=True)

            # 原来的分支找不到 <url> 就把整条丢掉。这里先拆出被引用原话和新打的字。
            quote = None
            if mtype not in ('文本', '语音', '图片', '表情', '动画表情'):
                quote_source = content
                if username.endswith('@chatroom') and sender and content.startswith(sender + ':'):
                    quote_source = content[len(sender) + 1:].lstrip()
                quote = parse_quote_content(quote_source)
            _quote_parsed = quote is not None
            image_ref = quote[3] if _quote_parsed else None
            if _quote_parsed:
                content = quote_content_text(quote)
                if not content:
                    skipped('引用消息里没有可读内容')
                    return
            if not _quote_parsed and mtype not in ('文本', '语音', '图片', '表情', '动画表情'):
                if '移出群聊' in content or '移出' in content:
                    self.dead_chats.add(username)
                    G.log('被移出群聊，停掉这个会话：', G.safe_name(self.display_name(username)))
                    return
                _low = content.lower()
                if 'finderfeed' in _low or '<type>51</type>' in _low or ('视频号' in content and '<url>' in _low):
                    G.log('收到视频号卡片，装死（不识别不回）')
                    return
                # 文档消息（PDF / Word / 纯文本）：先把文字抽出来交给模型读。
                _doc_name = doc_read.document_filename(msg, content) if doc_read else ''
                if '文件' in (mtype or ''):
                    # 排查用：把「真实到达这里的 mtype / content / 识别结果」钉进日志。
                    # 只有文件类消息才会打，平时不吵。
                    try:
                        G.log_throttled(
                            'doc-probe:%s' % (msg.get('local_id') or ''),
                            '文档探测：mtype=%s doc_read=%s len=%d head=%r name=%r isdoc=%s' % (
                                mtype, 'ok' if doc_read else 'None', len(content), content[:70],
                                _doc_name,
                                bool(doc_read and _doc_name and doc_read.is_document_name(_doc_name))),
                            ttl=30)
                    except Exception:
                        pass
                _doc_parsed = False
                # 同一份文件（标题+大小）短时间内重复发送：不再把整篇重复读进上下文，
                # 否则历史里会堆多份长文档，模型容易被旧的截断版本带偏。
                _doc_dup = False
                if doc_store and _doc_name:
                    try:
                        _doc_key = doc_store.key_from_content(content)
                        _doc_dup = bool(_doc_key) and doc_store.is_recent_dup(G.ROOT, _doc_key)
                    except Exception:
                        _doc_dup = False
                if _doc_dup:
                    content = ('（对方又发了一次同一份文档「%s」，内容和刚才那份一样，不用重复读；'
                               '想聊哪一部分直接说就行）' % _doc_name)
                    G.log('文档重复发送，跳过重复读取：', G.safe_name(_doc_name))
                    # 这条提示对同一文件是固定文本：不标记的话，第三次发送会被
                    # duplicate_guard 当成「重复消息」直接丢掉，用户什么反馈都收不到。
                    media_placeholder = True
                    _doc_parsed = True
                    desc = ''
                elif _doc_name and doc_read.is_document_name(_doc_name):
                    desc = run_media_with_timeout(lambda: self.read_document(msg, _doc_name), '文件', msg, G.log)
                    if desc:
                        # 读成功才记去重键：失败的下次还要再试
                        if doc_store:
                            try:
                                doc_store.remember(G.ROOT, doc_store.key_from_content(content))
                            except Exception:
                                pass
                        # 存档提示：模型后续想重读细节时，输出这个标记就能调回全文
                        _doc_note = msg.get('_doc_note') if isinstance(msg, dict) else ''
                        _doc_hash = msg.get('_doc_hash') if isinstance(msg, dict) else ''
                        _doc_tail = (('\n（这份文档已存档，哈希 [[doc:%s]]；之后想重读或核对细节，'
                                      '可以在回复里写这个标记调取，不要编造。）') % _doc_hash) if _doc_hash else ''
                        # 超过单段上限就分次读：第 1 段随这条消息走，其余在回复后接着读。
                        _chunk_size = int(msg.get('_doc_base') or 10000) if isinstance(msg, dict) else 10000
                        _max_chunks = int(msg.get('_doc_max_chunks') or 4) if isinstance(msg, dict) else 4
                        _chunks = doc_read.split_chunks(desc, _chunk_size, _max_chunks)
                        if len(_chunks) > 1:
                            # 长文档：先跟对方说一声「在读」，再把分段全文一次性交给模型，
                            # 让她读完再想、只回一条（不再每段发一条回复）。
                            if _doc_note:
                                _chunks[-1] = _chunks[-1] + '\n' + _doc_note
                            try:
                                self.send_text('这份文档有点长，我先看完再回你，稍等一下～',
                                               self.display_name(username), username)
                            except Exception as _e:
                                G.log('阅读提示没发出去（不影响读取）：', repr(_e))
                            _parts = ['【第 %d/%d 段】\n%s' % (_i, len(_chunks), _c)
                                      for _i, _c in enumerate(_chunks, 1)]
                            content = ('（对方发了一份文档「%s」，共 %d 段，以下是全文：\n%s）%s'
                                       % (_doc_name, len(_chunks), '\n\n'.join(_parts), _doc_tail))
                            G.log('长文档一次读完：共 %d 段，共 %d 字，只回一条'
                                  % (len(_chunks), sum(len(c) for c in _chunks)))
                        else:
                            content = '（对方发了一份文档「%s」，内容如下：\n%s）%s' % (
                                _doc_name, desc + (('\n' + _doc_note) if _doc_note else ''), _doc_tail)
                    else:
                        # 先保留真实原因，再记失败日志；media_failed 不能 pop 掉它，
                        # 否则后面只能拿到“原因未知”，守卫也看不到“下载失败”。
                        _why = ''
                        try:
                            _why = str((msg.get('_media_fail') if isinstance(msg, dict) else '') or '').strip()
                        except Exception:
                            _why = ''
                        media_failed('文件')
                        if ('没缓存' in _why) or ('找不到' in _why):
                            _advice = ('系统事实：这个文件没有下载到本地（%s），不是空文件、不是内容为空。'
                                       '回复必须直接说“文件还没下载到本地，我这边打不开”，'
                                       '请对方在聊天里点一下文件下载，或把文字贴出来；严禁说“文件本身空的/读不出来”。'
                                       % (_why[:60] or '原因未知'))
                        elif '解析' in _why:
                            _advice = ('文件拿到了但解析失败（%s）。如实说明，并请对方换成 docx / PDF '
                                       '或把文字贴出来。' % (_why[:40] or '原因未知'))
                        else:
                            _advice = ('没读到内容（%s）。如实说明，不要编造；可以让对方把文字贴出来。'
                                       % (_why[:40] or '原因未知'))
                        content = ('（对方发了一份文档「%s」，但这边没取到、也没读出来。%s）'
                                   % (_doc_name, _advice))
                        media_placeholder = True
                    _doc_parsed = True
                if not _doc_parsed:
                    import re as _re
                    mu = _re.search('<url>(.*?)</url>', content, _re.S)
                    mt = _re.search('<title>(.*?)</title>', content, _re.S)
                    if mu:
                        title = (mt.group(1).strip() if mt else '')[:60]
                        content = '分享了一个链接：%s %s' % (title, mu.group(1).strip())
                    else:
                        skipped('卡片/链接/文件消息没有可读正文（类型=%s）' % (mtype or '未知'))
                        return
            if G.ONLY_CHATS:
                try:
                    if self.display_name(username) not in G.ONLY_CHATS:
                        skipped('不在白名单会话内')
                        return
                except Exception:
                    skipped('白名单核对失败（读不到会话名）')
                    return
            if mtype == '文本' and not _quote_parsed:
                content = G.fix_garbled((msg.get('content') or '').strip())
                if username.endswith('@chatroom'):
                    content = G._GROUP_SENDER_PREFIX_RE.sub('', content, count=1).strip()
            if not content or (content.startswith('<') and mtype != '文本'):
                skipped('正文为空，或仍是没解析出来的 XML（类型=%s）' % (mtype or '未知'))
                return
            is_group = username.endswith('@chatroom')
            nickname = ''
            try:
                nickname = self.db.get_nickname(sender) or ''
            except Exception:
                nickname = ''
            if not nickname:
                nickname = '群友' if is_group else '微信好友'
            if G.is_system_notice(username, nickname, content):
                if G.ONLY_CHATS:
                    skipped('系统通知（白名单模式）')
                    return
                G.log('跳过系统通知：', G.safe_name(nickname), '：', G.safe_text(content))
                return
            # 取不到图的占位文本对同一个会话是固定的：如果直接拿去查重，连发两张图
            # 的第二张会被当成「重复消息」丢掉。所以占位文本按消息 id 查重，
            # 只挡微信真的把同一条消息重复投递的情况。
            _guard_text = content
            if media_placeholder or image_ref is not None:
                _guard_text = '%s#%s:%s' % (content, msg.get('shard') or '', msg.get('local_id'))
            _guard_id = msg.get('server_id') or msg.get('local_id') or msg.get('msg_id') or ''
            if G.duplicate_guard(username, sender, _guard_text, _guard_id):
                G.log('跳过重复消息（同一消息 id 重投）：', G.safe_name(nickname), '：', G.safe_text(content))
                return
            if '拍了拍' in content and '<url>' not in content:
                G.log('跳过拍一拍提示：', G.safe_text(content))
                return
            _names = self.self_mention_names(username) if is_group else []
            _mention = G.mention.analyze(
                content, _names, self.display_name(username) if is_group else '')
            addressed = bool(_mention['addressed'])
            _structured = None
            if is_group and '@' in content:
                # 优先用 source 里的 atuserlist（wxid），昵称改名也不会漏；
                # 读不到再退回显示名匹配。
                _structured = G.mention_meta.self_mentioned(
                    self.db, username, msg, self.self_identity_ids())
                if _structured is not None:
                    addressed = bool(_structured)
            _bare_mention = _mention['bare_any'] if _structured else _mention['bare_self']
            if username.endswith('@chatroom') and addressed and _bare_mention:
                try:
                    for m in self.db.get_messages(username, limit=12):
                        if m.get('type') != '文本':
                            continue
                        if (m.get('sender_username') or '') != sender:
                            continue
                        prev = G.fix_garbled((m.get('content') or '').strip())
                        prev = __import__('re').sub('^[A-Za-z0-9_\\-]{4,}:\\s*', '', prev).strip()
                        # 上一条如果已经叫过她，就不是「裸 @ 补问题」的素材。
                        # 这里必须用和 @ 解析同一套名字/归一化，不能用短别名的子串匹配。
                        if prev and not G.mention.contains_name(prev, _names):
                            content = prev
                            G.log('补上一条问题：', G.safe_text(prev))
                            break
                except Exception as e:
                    G.log('补问题失败：', repr(e))
            _mentioned_names = list(_mention['mentioned_names'])
            if is_group and not addressed and '@' in content:
                # 同一组「@对象」在每个群只提醒一次，避免正常 @ 别人也刷屏。
                # 这次「@许愿 被跳过」如果留着这条日志，一眼就能看到称呼表不对。
                G.log_throttled(
                    'mention-miss:%s:%s' % (
                        username, ','.join(sorted(_mentioned_names[:4])) or '?'),
                    '群消息含 @ 但没认出是叫我：@对象=%s 当前称呼=%s 会话=%s 消息id=%s:%s'
                    % (','.join(G.safe_name(x) for x in _mentioned_names[:4]) or '-',
                       ','.join(G.safe_name(x) for x in _names[:6]) or '-',
                       G.safe_id(username), msg.get('shard') or '', msg.get('local_id')),
                )
            G.log('收到', '群' if is_group else '私聊', G.safe_name(self.display_name(username)), '←', G.safe_name(nickname), '（%d 字）' % len(content))
            # 给内核的只放显示名；wxid/账号目录只参与 @ 元数据判断，别拿去匹配正文。
            try:
                _ids = self.self_identity_ids()
            except Exception:
                _ids = set()
            _payload_names = [n for n in (_names or []) if n not in _ids]
            if image_ref is not None:
                description = ''
                if self.send_policy_allows(username, self.display_name(username)):
                    description = run_media_with_timeout(lambda: self.describe_quoted_image(username, image_ref),
                                                         '图片', msg, G.log)
                    G.log('引用图片读取：%s' % ('已识别' if description else '未取到或未识别'))
                content = quote_content_text(quote, description)
            payload = {'chat_id': username, 'chat_type': 'group' if is_group else 'private', 'user_id': sender or 'unknown', 'senderId': sender or 'unknown', 'sender_id': sender or 'unknown', 'senderName': nickname, 'nickname': nickname, 'text': content, 'msg_id': '%s:%s:%s' % (username, msg.get('shard') or '', msg.get('local_id')), 'at_me': addressed, 'mentioned_names': _mentioned_names, 'self_names': _payload_names, 'chat_title': self.display_name(username) if is_group else ''}
            try:
                headers = {'x-whale-bridge': '1'}
                if self.token:
                    headers['x-bot-token'] = self.token
                # 模型生成耗时由内核控制，桥接不再用 120 秒读超时截断本轮回复。
                r = G.LOCAL_HTTP.post(self.bot_url, json=payload, headers=headers, timeout=(10, None))
                if r.status_code != 200:
                    G.CONN_STATE['ok'] = False
                    hint = '桥接 token 不匹配，请核对配置并重启桥接' if r.status_code in (401, 403) else '请查看内核诊断日志'
                    G.log_throttled('webhook-http:' + str(r.status_code), '鲸鲸接口返回 HTTP %s：%s' % (r.status_code, hint))
                    return
                data = r.json()
                if not isinstance(data, dict) or data.get('ok') is not True:
                    G.CONN_STATE['ok'] = False
                    G.log_throttled('webhook-response', '鲸鲸接口返回异常，未发送回复')
                    return
                if data.get('skipped') == 'adapter_disabled':
                    G.log_throttled('adapter-disabled', '微信网关未开启，请在启动器设置中开启 gateway.wechat.enabled')
                    return
            except Exception as e:
                _msg = repr(e)
                if '10061' in _msg or 'refused' in _msg.lower() or '积极拒绝' in _msg:
                    G.log_throttled('conn-refused', '连不上本地服务（积极拒绝 = 127.0.0.1 上没有程序在监听）。先在启动器里点「启动」，等状态变成「运行中」再来。')
                    if G.CONN_STATE.get('ok') is not False:
                        G.CONN_STATE['ok'] = False
                else:
                    G.log_throttled(
                        'webhook-fail:' + _msg[:40],
                        '请求鲸鲸失败：会话=%s 消息id=%s:%s:%s 原因=%s'
                        % (G.safe_name(self.display_name(username)), msg.get('shard') or '',
                           msg.get('local_id'), type(e).__name__, _msg[:120]),
                    )
                return
            if G.CONN_STATE.get('ok') is not True:
                G.CONN_STATE['ok'] = True
                G.log('已连上鲸鲸服务：', self.bot_url.rsplit('/webhook', 1)[0])
            if data.get('action') != 'reply' or not data.get('reply'):
                # 私聊也要留一条：否则“为什么没回”在日志里完全空白。
                G.log_throttled(
                    'no-reply:%s:%s' % (username, msg.get('local_id')),
                    '鲸鲸没接话：%s 会话=%s 消息id=%s:%s 原因=%s 字数=%d'
                    % (G.safe_name(nickname), G.safe_id(self.display_name(username)), msg.get('shard') or '',
                       msg.get('local_id'), data.get('reason'), len(content)),
                )
                return
            if data.get('mock') and (not G.MOCK_NOTICED['done']):
                G.MOCK_NOTICED['done'] = True
                G.log('[!] 服务端现在是「演示模式」：没配置 API Key，她回的是内置台词，不是真模型。')
                G.log('    去启动器「设置」填一把 Key（DeepSeek / 智谱 都行）就会切成真模型。')
            target = self.display_name(username)
            bubbles = data.get('bubbles')
            if not isinstance(bubbles, list):
                bubbles = [data['reply']]
            bubbles = [line for line in bubbles if isinstance(line, str) and line.strip()]
            if not bubbles:
                bubbles = [str(data['reply'])]
            mention = str(data.get('mention') or '').strip()
            if not G.rate_guard(username):
                if isinstance(data.get('sticker'), dict):
                    self.cancel_reply_sticker(data['sticker'], username)
                G.log('这一分钟回太多了，先停一下：', G.safe_name(target))
                return
            if data.get('stickerOnly') is True:
                sticker = data.get('sticker')
                if G.STICKER_TEST_ON and isinstance(sticker, dict):
                    self.claim_and_send_sticker(sticker, expected_chat=target, expected_username=username)
                return
            G.log('[delivery] stage=reply chatType=%s bubbles=%d chars=%d' % ('group' if is_group else 'private', len(bubbles), sum((len(x or '') for x in bubbles))))
            first = True
            if data.get('error') or data.get('commandType'):
                G.log('[voice] stage=decision result=skip reason=error_or_command_reply')
            elif data.get('separateText'):
                G.log('[voice] stage=decision result=skip reason=separate_text_requested')
            elif G.voice_reply.choose(G.voice_reply.settings(G.ROOT), content, is_group, G.random.random, log=G.log):
                spoken = '\n'.join((line.strip() for line in bubbles if line.strip()))
                if self.send_voice_reply(spoken, target, username):
                    if isinstance(data.get('sticker'), dict):
                        self.cancel_reply_sticker(data['sticker'], username)
                    G.log('[delivery] stage=voice result=handled textFallback=false stickerFallback=false reason=voice_may_have_sent')
                    return
                G.log('[voice] stage=delivery result=text_fallback reason=prepare_or_synthesis_failed')
            # 她给自己加/撤规矩：[[learn:...]] / [[unlearn:...]]
            try:
                if G.MASTER_WXID and (msg.get('sender_username') or '') == G.MASTER_WXID:
                    bubbles = self._apply_self_rules(bubbles, username)
            except Exception as _e:
                G.log('自我规则处理失败（忽略）：', repr(_e))

            # 抹掉她编的话（假回执 / 把发图说成派执行端），全被抹光就给一句正确说法
            try:
                _scrubbed = [scrub_reply_claims(_b) for _b in bubbles]
                _scrubbed = [_x for _x in _scrubbed if _x]
                bubbles = _scrubbed if _scrubbed else ["要图我这边直接找，不用派执行端。"]
            except Exception as _e:
                G.log('回复抹除失败（跳过，不影响发送）：', repr(_e))

            # 她回复里的自我改代码标记：[[patch:描述]]，抹掉标记后起受控委托
            _patches = []
            try:
                import re as _re3
                _PATCH = _re3.compile(r"\[\[patch:(.+?)\]\]", _re3.S)
                _kept_p = []
                for _b in bubbles:
                    for _m in _PATCH.finditer(_b):
                        _d = _m.group(1).strip()
                        if _d:
                            _patches.append(_d)
                    _nb = _PATCH.sub("", _b)
                    _nb = _re3.sub(r"[，,、]\s*[。！？!?]", "。", _nb).strip()
                    if _nb:
                        _kept_p.append(_nb)
                if _patches:
                    G.log('她想自己改代码：', ' | '.join(_patches)[:80])
                    bubbles = _kept_p or ['好，我去改。']
            except Exception as _e:
                G.log('自我改代码标记解析失败（忽略）：', repr(_e))

            # 她回复里的两种标记：[[dsh:任务]] 派活、[[pic:关键词]] 找图，都在发出去之前抹掉
            _dys = []
            _plats = []
            _tasks = []
            _pics = []
            _pic_blocked = []
            _pic_allowed = bool(G.MASTER_WXID and (msg.get('sender_username') or '') == G.MASTER_WXID
                                and not username.endswith('@chatroom'))
            _kept = []
            for _b in bubbles:
                _clean = _b
                if dsh_agent is not None:
                    _clean, _task = dsh_agent.extract_marker(_clean)
                    if _task:
                        _tasks.append(_task)
                if douyin_agent is not None:
                    _clean, _dy = douyin_agent.extract(_clean)
                    if _dy:
                        _dys.append(_dy)
                if platform_agent is not None:
                    _clean, _pf = platform_agent.extract(_clean)
                    if _pf:
                        _plats.append(_pf)
                if image_fetch is not None:
                    _clean, _key = image_fetch.extract(_clean)
                    if _key:
                        if _pic_allowed:
                            _pics.append(_key)
                        else:
                            _pic_blocked.append(_key)
                if _clean and _clean.strip():
                    _kept.append(_clean)
            if _tasks:
                G.log('她自己派活：', ' | '.join(_tasks)[:80])
            if _pics:
                G.log('她要找图：', ' | '.join(_pics)[:80])
            if _pic_blocked:
                G.log('发图被拒绝（仅主人私聊）：', ' | '.join(_pic_blocked)[:80])
            if _dys:
                G.log('她要刷抖音：', _dys[0][:60])
            if _plats:
                G.log('她要查平台：', _plats[0][:80])
            bubbles = _kept
            if picture_claim is not None and (bubbles or _pic_blocked):
                _mode = 'will_send' if _pics else ('blocked' if _pic_blocked else 'no_marker')
                _fixed = [picture_claim.scrub(_b, _mode) for _b in bubbles]
                _fixed = [_x for _x in _fixed if _x]
                if _pic_blocked:
                    if _fixed:
                        _fixed[-1] = picture_claim.append_blocked_note(_fixed[-1])
                    else:
                        _fixed = ['这个会话发不了图，我用文字说。']
                bubbles = _fixed
            for line in bubbles:
                if not line:
                    continue
                if first and mention and is_group:
                    body = line
                    for prefix in ('@%s' % mention, '@ %s' % mention):
                        if body.startswith(prefix):
                            body = body[len(prefix):].lstrip(' ，,：:')
                            break
                    if self.send_at(mention, body, target, username):
                        first = False
                        G.time.sleep(0.6)
                        continue
                    G.log('真 @ 失败，退回普通文本：', G.safe_name(mention))
                    if not line.startswith('@'):
                        line = '@%s %s' % (mention, line)
                quote_latest = bool(first and G.QUOTE_REPLY
                                    and data.get('commandType') != 'admin_spell'
                                    and self.is_latest_message(username, msg))
                if not self.send_text(line, target, username, quote_latest=quote_latest):
                    if isinstance(data.get('sticker'), dict):
                        self.cancel_reply_sticker(data['sticker'], username)
                    G.log('[delivery] stage=text result=failed reason=send_failed remainingBubbles=cancelled stickers=cancelled')
                    return
                first = False
                G.time.sleep(0.6)
            if _patches and G.MASTER_WXID and (msg.get('sender_username') or '') == G.MASTER_WXID \
                    and not username.endswith('@chatroom'):
                self._spawn_self_patch(_patches[0], username)
            if _pics and _pic_allowed:
                self._spawn_picture(_pics[0], username)
            if _tasks and G.MASTER_WXID and (msg.get('sender_username') or '') == G.MASTER_WXID \
                    and not username.endswith('@chatroom'):
                _now = G.time.time()
                _key = '_dsh_last_' + str(username)
                if _now - float(getattr(self, _key, 0) or 0) >= 45:
                    setattr(self, _key, _now)
                    self._spawn_delegation(' '.join(_tasks), username, msg.get('sender_username') or '')
                else:
                    G.log('她自己派活太密集，本次忽略（45 秒冷却）')
            if _dys and G.MASTER_WXID and (msg.get('sender_username') or '') == G.MASTER_WXID \
                    and not username.endswith('@chatroom'):
                _now = G.time.time()
                _key = '_dy_last_' + str(username)
                if _now - float(getattr(self, _key, 0) or 0) >= 20:
                    setattr(self, _key, _now)
                    self._spawn_douyin(_dys[0], username, msg.get('sender_username') or '')
                else:
                    G.log('抖音刷得太密集，本次忽略（20 秒冷却）')
            if _plats and G.MASTER_WXID and (msg.get('sender_username') or '') == G.MASTER_WXID  \
                    and not username.endswith('@chatroom'):
                _now = G.time.time()
                _key = '_pf_last_' + str(username)
                if _now - float(getattr(self, _key, 0) or 0) >= 20:
                    setattr(self, _key, _now)
                    self._spawn_platform(_plats[0], username, msg.get('sender_username') or '')
                else:
                    G.log('平台查询太密集，本次忽略（20 秒冷却）')
            _stk = data.get('sticker') or None
            if G.STICKER_TEST_ON and isinstance(_stk, dict):
                self.claim_and_send_sticker(_stk, expected_chat=target, expected_username=username)
            elif G.STICKER_TEST_ON:
                G.log('[sticker] stage=delivery result=skip reason=no_job_in_reply')
            # 分次阅读：剩下的段接着投给内核，让她顺着上一段继续读。
            _rest = msg.pop('_doc_chunks', None) if isinstance(msg, dict) else None
            if _rest:
                # 分次阅读要连续调模型 + 发送，放到后台线程，别把会话 worker 卡住
                try:
                    import threading as _th
                    _t = _th.Thread(
                        target=self.deliver_doc_chunks,
                        args=(_rest, msg.get('_doc_name') or '', target, username, sender, nickname,
                              msg.get('create_time') or 0),
                        name='doc-chunks', daemon=True)
                    _t.start()
                except Exception as _e:
                    G.log('分次阅读线程启动失败，改为同步：', repr(_e))
                    self.deliver_doc_chunks(_rest, msg.get('_doc_name') or '', target, username, sender, nickname)
        except Exception as e:
            G.log('处理消息异常：会话=%s 消息id=%s:%s 原因=%r'
                  % (G.safe_id(msg.get('username') or ''),
                     msg.get('shard') or '', msg.get('local_id'), e))

    def merge_text_batch(self, run, username):
        """同一个人连发的一串纯文本 → 合成一条消息交给服务端。

        只合并正文和消息 id；发送者、会话、shard 沿用最后一条。
        群消息正文前面带的 "wxid_xxx:" 前缀要先逐条剥掉，不然合并后
        模型会看到一串 wxid（原来每条各自剥，合并后只剥一次就漏了）。
        """
        merged = dict(run[-1])
        parts = []
        ids = []
        for m in run:
            text = G.fix_garbled((m.get('content') or '').strip())
            if username.endswith('@chatroom'):
                text = G._GROUP_SENDER_PREFIX_RE.sub('', text, count=1).strip()
            if text:
                parts.append(text)
            ids.append(str(m.get('local_id')))
        if not parts:
            return [run[-1]]
        merged['content'] = '\n'.join(parts)
        merged['local_id'] = '|'.join(ids)
        G.log('合并 %d 条连发消息一起回：%s' % (len(run), G.safe_text(' / '.join(parts))))
        return [merged]

    def flush_chat(self, chat, listener):
        """这个会话的上一轮跑完了：把攒下的消息取走，逐组处理。

        同一轮里同一个人连发的几条合成一条（只调一次模型、只发一次），
        不同人的消息分开回，顺序不乱。
        """
        try:
            items = self.batches.take(chat)
        except Exception as e:
            G.log('取消息批次失败：', repr(e))
            return
        if not items:
            return
        for run in G.split_runs(items):
            username = (run[0] or {}).get('username') or ''
            todo = self.merge_text_batch(run, username) if G.mergeable(run) else run
            for msg in todo:
                try:
                    self.on_message_inner(msg, listener)
                except Exception as e:
                    G.log('处理消息异常：会话=%s 消息id=%s:%s 原因=%r'
                          % (G.safe_id((msg or {}).get('username') or ''),
                             (msg or {}).get('shard') or '',
                             (msg or {}).get('local_id'), e))

    def _self_patch_state(self):
        """读自我改代码的审计记录，返回 (今天的失败次数, 今天的总次数)。"""
        import json as _json
        p = G.os.path.join(G.ROOT, 'data', 'self', 'changes.jsonl')
        today = G.time.strftime('%Y-%m-%d')
        fail = total = 0
        try:
            if not G.os.path.exists(p):
                return 0, 0
            with open(p, encoding='utf-8') as f:
                for line in f:
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        d = _json.loads(line)
                    except Exception:
                        continue
                    if str(d.get('at') or '')[:10] != today:
                        continue
                    total += 1
                    if not d.get('ok'):
                        fail += 1
        except Exception:
            pass
        return fail, total

    def _spawn_self_patch(self, desc, username):
        """她自己要改代码：走写权限委托，跑自测，熔断防连炸。"""
        desc = str(desc or '').strip()
        if not desc:
            return
        target = self.display_name(username)
        # 自检失败过就先别自修：越修越坏是真实风险
        try:
            _fz = G.os.path.join(G.ROOT, 'data', 'self', 'freeze.json')
            if G.os.path.exists(_fz):
                import json as _jf
                _d = _jf.load(open(_fz, encoding='utf-8'))
                G.log('自修被冻结（自检失败过）：', str(_d.get('fails'))[:60])
                self.send_text('自检还没过，我先不自修代码了（原因：%s）。先把自检弄绿。'
                               % ('、'.join(_d.get('fails') or [])[:60]), target, username)
                return
        except Exception:
            pass
        fail, total = self._self_patch_state()
        if fail >= 3:
            G.log('自我改代码熔断：今天已失败 %d 次' % fail)
            try:
                self.send_text('今天改代码已经失败三次了，先不折腾，明天再说。', target, username)
            except Exception:
                pass
            return
        try:
            self.send_text('我想自己改一下：%s。先备份，改完跑自测，不过就还原。' % desc[:40], target, username)
        except Exception:
            pass

        def _work():
            import json as _json
            t0 = G.time.time()
            ok = False
            detail = ''
            try:
                prompt = (
                    '你要给鲸鲸（WhaleGirl，安装在她自己的目录：%s）改代码。\n'
                    '重要：她的目录不在你的工作区里，所有路径都按这个根目录补成绝对路径。\n'
                    '需求：%s\n'
                    '硬性规则：\n'
                    '1) 动手前先把要改的每个文件备份成 <文件名>.bak-self-<时间戳>；\n'
                    '2) 小步改，只动和需求有关的行，不要顺手重构；\n'
                    '3) 改完必须运行：%s %s\n'
                    '4) 自测不通过就把备份还原回去，并说明失败原因；\n'
                    '5) 最后单独一行写「自测通过」或「已还原」。'
                    % (G.ROOT, desc,
                       G.os.path.join(G.ROOT, 'runtime', 'python', 'python.exe'),
                       G.os.path.join(r'D:\dsh\profiles\desktop', '鲸鲸-自测.py'))
                )
                # 她的目录在工作区之外，workspace-write 写不进去，必须显式全盘权限；
                # 安全网：先备份 + 必须过自测 + 连续失败熔断 + 全量审计。
                # 自我改代码本身就是「备份→改→跑自测」多步，必须连续执行，
                # 否则会被守则第 2 条「先做第一件就停」截断
                ok_run, detail = dsh_agent.run_task(prompt, force_write=True, timeout=240,
                                                    mode='danger-full-access',
                                                    continuous=True,
                                                    chat=username, sender=G.MASTER_WXID or '')
                ok = bool(ok_run) and ('自测通过' in str(detail))
            except Exception as e:
                detail = '自我改代码异常：%r' % e
            # 审计
            try:
                p = G.os.path.join(G.ROOT, 'data', 'self', 'changes.jsonl')
                G.os.makedirs(G.os.path.dirname(p), exist_ok=True)
                with open(p, 'a', encoding='utf-8') as f:
                    f.write(_json.dumps({
                        'at': G.time.strftime('%Y-%m-%d %H:%M:%S'),
                        'desc': desc[:120],
                        'ok': ok,
                        'elapsed': round(G.time.time() - t0, 1),
                        'result': str(detail)[:300],
                    }, ensure_ascii=False) + '\n')
            except Exception:
                pass
            G.log('自我改代码：%s | %s' % ('通过' if ok else '未通过', desc[:40]))
            try:
                if ok:
                    self.send_text('改好了，自测通过。改的是：%s' % desc[:40], target, username)
                else:
                    self.send_text('没改成（或自测没过），已按规则还原。原因：%s' % str(detail)[:120],
                                   target, username)
            except Exception:
                pass

        import threading as _th
        _th.Thread(target=_work, name='self-patch', daemon=True).start()

    def _apply_self_rules(self, bubbles, username):
        """她从回复里给自己加/撤规矩：[[learn:说话更短]] / [[unlearn:感叹号]]。

        只认主人私聊；规则落盘后内核下一轮就会读进去，不需要重启。
        """
        import json as _json
        import re as _re
        LEARN = _re.compile(r"\[\[learn:(.+?)\]\]", _re.S)
        UNLEARN = _re.compile(r"\[\[unlearn:(.+?)\]\]", _re.S)
        out = []
        for b in bubbles:
            for m in LEARN.finditer(b):
                text = m.group(1).strip()
                try:
                    if not text or len(text) > 80:
                        G.log('自我规则过长，忽略：', text[:30])
                        continue
                    if _re.search(r"忽略(安全|规则|限制)|越狱|管理员权限|绕过|不遵守", text):
                        G.log('自我规则越权，拒绝：', text[:30])
                        continue
                    d = os.path.join(G.ROOT, 'data', 'self', 'rules.json')
                    data = {"rules": [], "updated": 0}
                    if os.path.exists(d):
                        try:
                            data = _json.load(open(d, encoding='utf-8'))
                        except Exception:
                            data = {"rules": [], "updated": 0}
                    rules = data.get('rules') or []
                    if any(r.get('text') == text for r in rules):
                        G.log('自我规则已存在，跳过：', text[:20])
                        continue
                    if len(rules) >= 40:
                        G.log('自我规则满了（40 条），忽略：', text[:20])
                        continue
                    rules.append({"text": text, "at": int(G.time.time()), "source": "self"})
                    data['rules'] = rules
                    data['updated'] = int(G.time.time())
                    os.makedirs(os.path.dirname(d), exist_ok=True)
                    tmp = d + '.tmp'
                    with open(tmp, 'w', encoding='utf-8') as f:
                        _json.dump(data, f, ensure_ascii=False, indent=1)
                    os.replace(tmp, d)
                    G.log('她给自己加了条规矩：', text[:30])
                except Exception as e:
                    G.log('写自我规则失败：', repr(e))
            for m in UNLEARN.finditer(b):
                key = m.group(1).strip()
                try:
                    d = os.path.join(G.ROOT, 'data', 'self', 'rules.json')
                    if not os.path.exists(d) or not key:
                        continue
                    data = _json.load(open(d, encoding='utf-8'))
                    before = len(data.get('rules') or [])
                    data['rules'] = [r for r in (data.get('rules') or []) if key not in r.get('text', '')]
                    if len(data['rules']) != before:
                        with open(d, 'w', encoding='utf-8') as f:
                            _json.dump(data, f, ensure_ascii=False, indent=1)
                        G.log('她撤掉了规矩：', key[:20])
                except Exception as e:
                    G.log('撤销自我规则失败：', repr(e))
            had_marker = bool(LEARN.search(b) or UNLEARN.search(b))
            cleaned = LEARN.sub('', b)
            cleaned = UNLEARN.sub('', cleaned)
            cleaned = _re.sub(r"[，,、]\s*[。！？!?]", "。", cleaned).strip()
            if cleaned:
                out.append(cleaned)
            elif had_marker:
                out.append('好，记下了。')     # 整句只有标记：给一句应答，别把 [[...]] 发出去
        return out if out else ['嗯。']


    def _remember_skipped(self, msg):
        """桥接失联/重启期间被跳过的消息：至少写进记忆原文，不触发回复。"""
        try:
            username = str(msg.get('username') or '').strip()
            if not username:
                return
            text = str(msg.get('content') or '').strip()
            typ = str(msg.get('type') or '消息')
            if text.startswith('<?xml') or text.startswith('<msg'):
                text = '[%s]' % typ
            if not text:
                return
            # 每次启动最多补 50 条：长时间停机的 backlog 不要一次性灌进记忆
            _n = int(getattr(self, '_ingest_count', 0) or 0)
            if _n >= 50:
                G.log_throttled('ingest-capped', '失联消息补记已达本次启动上限 50 条，其余跳过', ttl=3600)
                return
            chat_type = 'group' if username.endswith('@chatroom') else 'private'
            chat = ('wechat:g:' if chat_type == 'group' else 'wechat:u:') + username
            base = self.bot_url.rsplit('/webhook', 1)[0]
            uid = str(msg.get('sender_username') or username)
            ts = int(float(msg.get('create_time') or 0) * 1000) or None
            msg_id = '%s:%s' % (msg.get('shard') or '', msg.get('local_id') or '')
            G.LOCAL_HTTP.post(base + '/api/memory/ingest', json={
                'chat': chat, 'uid': uid, 'name': str(msg.get('sender_name') or ''),
                'text': text[:4000], 'ts': ts, 'msgId': msg_id, 'chatType': chat_type,
            }, headers={'x-whale-bridge': '1', 'x-whale-bridge-token': self.token or ''}, timeout=6)
            self._ingest_count = _n + 1
        except Exception as e:
            G.log_throttled('ingest-skip-fail', '失联消息补记失败（忽略）：' + repr(e), ttl=120)

    def _recover_delegation_once(self):
        """重启后第一次收消息时跑一次：把上次打断的委托告诉主人，别让它悄悄消失。"""
        if getattr(self, '_deleg_recovered', False):
            return
        self._deleg_recovered = True
        try:
            jobs = dsh_agent.take_interrupted()
        except Exception as e:
            G.log('委托恢复检查失败：', repr(e))
            return
        if not jobs:
            return
        G.log('发现被重启打断的委托：%d 个' % len(jobs))
        if not G.MASTER_WXID:
            return
        try:
            target = self.display_name(G.MASTER_WXID)
            lines = ['上次有个活没跑完就重启了，被打断：']
            for j in jobs[:3]:
                lines.append('- %s（%s 开始）' % (str(j.get('task') or '')[:40], j.get('started_at') or '?'))
            lines.append('要重做的话再派一次就行。')
            self.send_text('\n'.join(lines), target, G.MASTER_WXID)
        except Exception as e:
            G.log('打断提示没发出去：', repr(e))

    def on_message(self, msg, listener):
        try:
            # 执行脑命令优先接管；普通消息照常走原 pipeline
            try:
                if getattr(self, 'brain', None) and self.brain.handle_message(msg):
                    return
            except Exception as e:
                G.log('执行脑处理失败（继续普通聊天）：', repr(e))
            # P0：委托硬审批（只认当前会话，只消费明确可以/不要）
            try:
                import delegation_approval
                _d = delegation_approval.consume(msg.get('username') or '', msg.get('content') or '')
                if _d:
                    _it = _d['item']
                    if _d['action'] == 'reject':
                        self.send_text('好，那先不动。', self.display_name(msg.get('username') or ''), msg.get('username') or '')
                    elif _d['action'] == 'more':
                        self.send_text('还差一次确认：回复「可以」才会执行。', self.display_name(msg.get('username') or ''), msg.get('username') or '')
                    else:
                        self._spawn_delegation(_it['task'], msg.get('username') or '', _it.get('sender') or '', force=True, approved=True, audit_id=_it.get('task_id'))
                    return
            except Exception as _e:
                G.log('委托审批处理失败（继续普通聊天）：', repr(_e))
            try:
                self._recover_delegation_once()
            except Exception as _e:
                G.log('委托恢复检查出错（忽略）：', repr(_e))
            username = msg.get('username') or ''
            create_time = float(msg.get('create_time') or 0)
            grace = late_grace_sec(username)
            if create_time and create_time < G.START_TS - G.SKIP_OLDER_THAN - grace:
                G.log_throttled(
                    'msg-too-old:%s' % (username or 'unknown'),
                    '消息未处理：早于本次启动太多（消息id=%s:%s，创建时间=%s）'
                    % (msg.get('shard') or '', msg.get('local_id'), int(create_time)),
                    ttl=60,
                )
                self._remember_skipped(msg)
                return
            if create_time and G.time.time() - create_time > G.STALE_AFTER + grace:
                G.log('跳过过期消息（%.0fs 前）：%s' % (G.time.time() - create_time, G.safe_text(msg.get('content') or '')))
                self._remember_skipped(msg)
                return
            chat = username or 'unknown'
            pushed = self.batches.push(chat, msg)
            # 纯文本走安静窗口。注意：第一条把 chat 标成 queued 后，后续 push 返回
            # False，所以不能拿 pushed 当“要不要重置计时”的条件。
            if (msg.get('type') or '') == '文本':
                try:
                    self.settle.touch(chat, username.endswith('@chatroom'))
                except Exception as e:
                    # 收集器异常时退回旧行为：立刻提交一次，别把消息闷在 batches 里。
                    G.log('消息收集失败，改为立即处理：', repr(e))
                    try:
                        queued = self.pipeline.submit(chat, self.flush_chat, chat, listener)
                    except Exception as inner:
                        queued = False
                        G.log('消息入队失败：', repr(inner))
                    if not queued:
                        self.batches.release(chat)
                        G.log_throttled(
                            'queue-closed:%s' % chat,
                            '消息没能排上队（调度已关闭）：会话=%s 消息id=%s:%s'
                            % (G.safe_id(chat), msg.get('shard') or '', msg.get('local_id')),
                            ttl=60,
                        )
            elif pushed:
                # 图片/语音/卡片等不合并，仍立即走旧流程。
                try:
                    queued = self.pipeline.submit(chat, self.flush_chat, chat, listener)
                except Exception as inner:
                    queued = False
                    G.log('消息入队失败：', repr(inner))
                if not queued:
                    self.batches.release(chat)
                    G.log_throttled(
                        'queue-closed:%s' % chat,
                        '消息没能排上队（调度已关闭）：会话=%s 消息id=%s:%s'
                        % (G.safe_id(chat), msg.get('shard') or '', msg.get('local_id')),
                        ttl=60,
                    )
        except Exception as e:
            G.log('提交消息处理失败：', repr(e))

    def recent_chats(self, limit=2, within=1800):
        out = []
        try:
            for s in self.db.get_sessions(limit=20):
                u = s.get('username') or ''
                if not u or u == 'filehelper':
                    continue
                try:
                    ms = self.db.get_messages(u, limit=1)
                except Exception:
                    continue
                if not ms:
                    continue
                t = float(ms[0].get('create_time') or 0)
                if t and G.time.time() - t > within:
                    continue
                out.append((u, self.display_name(u)))
                if len(out) >= limit:
                    break
        except Exception:
            pass
        return out
