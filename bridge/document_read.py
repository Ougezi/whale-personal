# -*- coding: utf-8 -*-
"""文档读取：微信里收到 PDF / docx / txt 文件时，提取正文交给内核。

设计约定：
- 只做「提取文字」，不还原排版；结果截断到上限后交给聊天模型。
- PDF 用 pypdfium2（内置 pdfium 单文件，无系统依赖），从 bridge/vendor 加载；
- docx 是 zip 包（word/document.xml），用标准库 zipfile + 正则直接取 <w:t>；
- txt / md 按常见编码尝试解码；旧版二进制 .doc 明确报「请转成 .docx / PDF」；
- 扫描件（纯图片 PDF）提取不出文字，会明确报错，而不是给空串。

所有函数纯文本进出、无副作用，方便单测；下载由调用方（ReceiverMixin）负责。
"""
import html
import io
import os
import re
import sys
import zipfile

# 正文上限：太长会撑爆聊天上下文。可在 config.json 里加 document.maxChars 覆盖，
# 或用环境变量 WHALE_DOC_MAX_CHARS 覆盖（两者都限制在 500~12000 之间）。
DEFAULT_MAX_CHARS = 4000
MAX_BYTES = 8 * 1024 * 1024
DOC_EXT = {'.pdf', '.docx', '.doc', '.txt', '.md', '.text', '.xlsx', '.pptx'}


def _vendor_path():
    here = os.path.dirname(os.path.abspath(__file__))
    vendor = os.path.join(here, 'vendor')
    if os.path.isdir(vendor) and vendor not in sys.path:
        sys.path.insert(0, vendor)
    return vendor


def extract_pdf(path):
    _vendor_path()
    import pypdfium2 as pdfium
    pdf = pdfium.PdfDocument(path)
    parts = []
    for i in range(len(pdf)):
        try:
            piece = pdf[i].get_textpage().get_text_range().strip()
        except Exception:
            piece = ''
        if piece:
            parts.append(piece)
    return '\n'.join(parts)


def render_pdf_pages(path, max_pages=3, scale=2.0):
    """把 PDF 前几页渲染成 JPEG 字节，供视觉接口做 OCR（扫描件用）。"""
    _vendor_path()
    import pypdfium2 as pdfium
    pdf = pdfium.PdfDocument(path)
    pages = []
    for i in range(min(len(pdf), max(1, int(max_pages)))):
        try:
            img = pdf[i].render(scale=float(scale)).to_pil().convert('RGB')
            buf = io.BytesIO()
            img.save(buf, format='JPEG', quality=85)
            pages.append(buf.getvalue())
        except Exception:
            continue
    return pages


def _xml_text_between(xml, tag):
    # 兼容 w: 前缀和无前缀两种 docx 写法；返回所有 <tag>...</tag> 的正文拼接
    out = []
    for m in re.finditer(r'<[^>]*?:%s(?:\s[^>]*)?>(.*?)</[^>]*?:%s>' % (tag, tag), xml, re.S):
        out.append(m.group(1))
    return ''.join(out)


def extract_docx(path):
    with zipfile.ZipFile(path) as z:
        names = z.namelist()
        if 'word/document.xml' not in names:
            raise ValueError('不是有效的 docx（缺少 word/document.xml）')
        xml = z.read('word/document.xml').decode('utf-8', 'replace')
    lines = []
    for para in re.split(r'</[^>]*?:p>', xml):
        text = html.unescape(_xml_text_between(para, 't'))
        text = re.sub(r'<[^>]+>', '', text)  # 万一还有残留标签
        text = text.replace('\u00a0', ' ').strip()
        if text:
            lines.append(text)
    return '\n'.join(lines)


def _read_text_file(path):
    with open(path, 'rb') as f:
        raw = f.read()
    for enc in ('utf-8', 'gbk', 'utf-16', 'latin-1'):
        try:
            return raw.decode(enc)
        except (UnicodeDecodeError, UnicodeError):
            continue
    return raw.decode('utf-8', 'replace')


def extract_xlsx(path):
    """xlsx：zip 包里的 sharedStrings + worksheets，标准库就能读。

    输出按「工作表 → 行 → 单元格（用 | 分隔）」的纯文本，模型读起来像表格。
    """
    with zipfile.ZipFile(path) as z:
        names = set(z.namelist())
        shared = []
        if 'xl/sharedStrings.xml' in names:
            sx = z.read('xl/sharedStrings.xml').decode('utf-8', 'replace')
            for si in re.findall(r'<si>(.*?)</si>', sx, re.S):
                shared.append(''.join(html.unescape(t) for t in re.findall(r'<t[^>]*>(.*?)</t>', si, re.S)))
        sheets = sorted(n for n in names if re.match(r'xl/worksheets/sheet\d+\.xml$', n))
        if not sheets:
            raise ValueError('不是有效的 xlsx（没有工作表）')
        out = []
        for idx, sn in enumerate(sheets, 1):
            xml = z.read(sn).decode('utf-8', 'replace')
            out.append('【工作表 %d】' % idx)
            for row in re.findall(r'<row[^>]*>(.*?)</row>', xml, re.S):
                cells = []
                for cm in re.finditer(r'<c\b([^>]*)>(.*?)</c>', row, re.S):
                    attrs, body = cm.group(1), cm.group(2)
                    tm = re.search(r'\bt="([^"]*)"', attrs)
                    ctype = tm.group(1) if tm else ''
                    vm = re.search(r'<v>(.*?)</v>', body, re.S)
                    if vm:
                        val = html.unescape(vm.group(1))
                        if ctype == 's':
                            try:
                                val = shared[int(val)]
                            except Exception:
                                pass
                        cells.append(val)
                    else:
                        im = re.search(r'<is>(.*?)</is>', body, re.S)
                        if im:
                            cells.append(''.join(html.unescape(x) for x in
                                                 re.findall(r'<t[^>]*>(.*?)</t>', im.group(1), re.S)))
                if cells:
                    out.append(' | '.join(cells))
        return '\n'.join(out)


def extract_pptx(path):
    """pptx：逐页取 <a:t> 里的文字。"""
    with zipfile.ZipFile(path) as z:
        slides = [n for n in z.namelist() if re.match(r'ppt/slides/slide\d+\.xml$', n)]
        if not slides:
            raise ValueError('不是有效的 pptx（没有幻灯片）')
        slides.sort(key=lambda s: int(re.search(r'(\d+)\.xml$', s).group(1)))
        out = []
        for i, sn in enumerate(slides, 1):
            xml = z.read(sn).decode('utf-8', 'replace')
            texts = [html.unescape(t).strip() for t in re.findall(r'<a:t>(.*?)</a:t>', xml, re.S)]
            body = ' '.join([t for t in texts if t])
            if body:
                out.append('【第 %d 页】%s' % (i, body))
        return '\n'.join(out)


def extract_doc(path):
    """旧版 .doc（OLE 二进制）：尽力提取，可能夹带少量乱码。

    Word 97+ 的正文主体是 UTF-16LE；GBK 只在 UTF-16 几乎没捞到东西时才兜底，
    否则整块字节按 GBK 解出来的会是**随机汉字**（看着像中文，其实没有意义）。
    """
    with open(path, 'rb') as f:
        raw = f.read()

    def good_char(ch):
        o = ord(ch)
        if ch in ' \t\r\n':
            return True
        if 0x20 <= o <= 0x7E:
            return True
        if 0x4E00 <= o <= 0x9FFF:
            return True
        if 0x3000 <= o <= 0x303F:
            return True
        if 0xFF00 <= o <= 0xFFEF:
            return True
        return False

    def looks_like_text(s):
        if len(s) < 6:
            return False
        if any(not good_char(ch) for ch in s):
            return False
        cjk = sum(1 for ch in s if '\u4e00' <= ch <= '\u9fff')
        alnum = sum(1 for ch in s if ch.isalnum())
        # 纯 ASCII 的短碎段（"1r4twm" 这种）不要；中文段要求至少有 2 个汉字
        if cjk == 0 and len(s) < 12:
            return False
        return (cjk + alnum) >= 3

    def harvest(text, out):
        cur = []
        for ch in text:
            if ch.isprintable() or ch in '\r\n\t':
                cur.append(ch)
            else:
                if len(cur) >= 6:
                    out.append(''.join(cur))
                cur = []
        if len(cur) >= 6:
            out.append(''.join(cur))

    def filt(chunks):
        seen, kept = set(), []
        for c in chunks:
            c = c.strip()
            if not c or c in seen or not looks_like_text(c):
                continue
            seen.add(c)
            kept.append(c)
        return kept

    u16 = []
    try:
        harvest(raw.decode('utf-16-le', 'ignore'), u16)
    except Exception:
        pass
    kept = filt(u16)

    # 只有 UTF-16 真的啥都没捞到（纯 ANSI 存档）才用 GBK 兜底；
    # 反过来只要 UTF-16 有内容就不跑 GBK，避免随机汉字混进正文。
    if sum(len(x) for x in kept) < 6:
        gbk = []
        try:
            harvest(raw.decode('gbk', 'ignore'), gbk)
        except Exception:
            pass
        for c in filt(gbk):
            if c not in kept:
                kept.append(c)
    return '\n'.join(kept)


def extract_document_text(path, filename):
    ext = os.path.splitext(str(filename or path) or '')[1].lower()
    if ext == '.pdf':
        return extract_pdf(path)
    if ext == '.docx':
        return extract_docx(path)
    if ext == '.xlsx':
        return extract_xlsx(path)
    if ext == '.pptx':
        return extract_pptx(path)
    if ext in ('.txt', '.md', '.text'):
        return _read_text_file(path)
    if ext == '.doc':
        return extract_doc(path)
    raise ValueError('不支持的文件类型：%s' % (ext or '未知'))


def _clean_filename(value):
    """去掉 CDATA 包装 / HTML 实体 / 首尾空白。

    微信 4.x 有的版本把文件名包成 <![CDATA[日记.pdf]]>。不剥掉的话，
    splitext 得到的扩展名是「.pdf]]>」，is_document_name 判成 False，
    整条文件消息就被当成普通卡片跳过了（真实日志里就是这个现象）。
    """
    s = html.unescape(str(value or '')).strip()
    m = re.match(r'^<!\[CDATA\[(.*)\]\]>$', s, re.S)
    if m:
        s = m.group(1).strip()
    # 兜底：CDATA 没闭合或带残留时，按最外层标记再剥一次
    if s.startswith('<![') or s.endswith(']]>'):
        s = re.sub(r'^<!\[CDATA\[|\]\]>$', '', s).strip()
    return s


def is_document_name(filename):
    return os.path.splitext(_clean_filename(filename))[1].lower() in DOC_EXT


def document_filename(msg, content):
    """从文件消息里取原文件名：msg 字段 → appmsg <title> → <fileext>。"""
    try:
        from urllib.parse import unquote
    except Exception:
        def unquote(s):
            return s
    for key in ('filename', 'file_name', 'title'):
        v = _clean_filename((msg or {}).get(key))
        if v and '.' in v:
            return unquote(v)
    name = ''
    m = re.search(r'<title>(.*?)</title>', content or '', re.S)
    if m:
        name = _clean_filename(m.group(1))
    if name and '.' in name:
        return unquote(name)
    m = re.search(r'<fileext>(.*?)</fileext>', content or '', re.S)
    if m:
        ext = _clean_filename(m.group(1))
        if ext:
            # title 本身没带扩展名时（如 <title>日记</title><fileext>pdf</fileext>），
            # 以前会原样返回「日记」，is_document_name 判成 False 就整条跳过了。
            base = name.rsplit('.', 1)[0] if '.' in name else name
            return (base or '文档') + '.' + ext
    return name or ''


def split_chunks(text, size, max_chunks=4):
    """把长文切成最多 max_chunks 段，尽量在段落/句子边界切，避免把一句话劈开。"""
    text = str(text or '')
    size = max(200, int(size or 0))
    max_chunks = max(1, int(max_chunks or 1))
    out = []
    i = 0
    while i < len(text) and len(out) < max_chunks:
        end = min(len(text), i + size)
        if end < len(text):
            cut = text.rfind('\n', i + size // 2, end)
            if cut <= i:
                for mark in ('。', '！', '？', '；', '\n'):
                    cut = text.rfind(mark, i + size // 2, end)
                    if cut > i:
                        cut += 1
                        break
            if cut > i:
                end = cut
        out.append(text[i:end])
        i = end
    # 按句号/换行切会每段都少收一点，最后一段吸收余量，否则尾部几十字会被丢掉
    covered = sum(len(x) for x in out)
    if out and covered < len(text):
        out[-1] = out[-1] + text[covered:]
    return out


def default_max_chars(cfg=None):
    v = os.environ.get('WHALE_DOC_MAX_CHARS')
    if v:
        try:
            return max(500, min(12000, int(v)))
        except ValueError:
            pass
    if cfg:
        try:
            m = int((cfg.get('document') or {}).get('maxChars') or 0)
            if m:
                return max(500, min(12000, m))
        except Exception:
            pass
    return DEFAULT_MAX_CHARS


def describe_document(path, filename, max_chars=None, ocr=None):
    """下载完成后的提取 + 截断。返回 (text, note)；提取不出文字会抛 ValueError。

    ocr：可选的兜底回调（签名 ocr(path) -> text）。文字层为空时（扫描件 / 图片型 PDF）
         用它把页面交给视觉接口转写；没传就按原逻辑报错。
    """
    if max_chars is None:
        max_chars = default_max_chars()
    size = os.path.getsize(path)
    if size > MAX_BYTES:
        raise ValueError('文件太大（%.1f MB，上限 8 MB），没读' % (size / 1024 / 1024))
    text = extract_document_text(path, filename)
    text = re.sub(r'\n{3,}', '\n\n', text).strip()
    ocr_note = ''
    if not text and ocr is not None:
        try:
            text = str(ocr(path) or '').strip()
        except Exception:
            text = ''
        if text:
            ocr_note = '（这份是扫描件/图片型 PDF，文字由视觉识别得出，可能有错漏）'
    if not text:
        raise ValueError('没提取出文字：可能是扫描件 / 纯图片 PDF、加密文档，或格式不受支持')
    note = ocr_note
    if len(text) > max_chars:
        note = (note + '（文档较长，已截取前 %d 字）' % max_chars).strip()
        text = text[:max_chars]
    return text, note
