"""图片预处理：自适应切段 + 窄图放大 + 说明性日志。

鲸鲸原来的做法是：高宽比 > 2.2 且高 > 1200 就固定切 2~3 段。两个问题：
  1. 15:1 这种超长截图切完每段还是 1:6，视觉接口把长边压到 1568 以内后字全糊；
  2. 段数写死，图越长越糟，而且一次要等 30 秒以上才放弃。
现在按「每段不超过 TARGET_TILE_H」自适应切，窄图先放大到可读宽度，并把
「这图读不了」的原因交给上层，让鲸鲸能如实回一句「看不清」。

纯逻辑（plan_tiles）和 PIL 部分（prepare_image）分开，方便单独测。
"""
import io
import math

TARGET_TILE_H = 1400      # 每段目标高度（多数视觉接口长边上限 1568，留余量）
MIN_TILE_H = 500          # 段再矮就不切了，切碎反而丢上下文
MAX_TILES = 12            # 段数上限：再多就是烧钱 + 超时
READABLE_WIDTH = 720      # 低于这个宽度先放大
MAX_UPSCALE = 3           # 放大上限：超过 3 倍基本是插值糊出来的，没有信息量
JPEG_QUALITY = 88


def plan_tiles(width, height):
    """算出放大倍数和竖直切段区间。返回 {'upscale', 'tiles': [(top, bottom)], ...}。"""
    w = max(1, int(width))
    h = max(1, int(height))
    upscale = 1
    if w < READABLE_WIDTH:
        upscale = max(1, min(MAX_UPSCALE, int(math.ceil(READABLE_WIDTH / float(w)))))
    target = max(MIN_TILE_H, TARGET_TILE_H // upscale)
    if h <= int(target * 1.15):
        tiles = [(0, h)]
    else:
        n = int(math.ceil(h / float(target)))
        n = max(2, min(MAX_TILES, n))
        seg = h / float(n)
        overlap = max(24, int(seg * 0.06))
        tiles = []
        for i in range(n):
            top = max(0, int(i * seg) - (overlap if i else 0))
            bottom = min(h, int((i + 1) * seg) + (overlap if i < n - 1 else 0))
            tiles.append((top, max(top + 1, bottom)))
    return {
        'upscale': upscale,
        'tiles': tiles,
        'width': w,
        'height': h,
        'out_width': w * upscale,
        'readable': w * MAX_UPSCALE >= READABLE_WIDTH,
    }


def prepare_image(raw):
    """把原图字节变成「可以发给视觉接口」的 JPEG 分片。

    返回 (parts, mime, note)。note 是给人看的一句日志，没有可说的就返回 '。
    """
    from PIL import Image

    img = Image.open(io.BytesIO(raw))
    img.load()
    plan = plan_tiles(img.width, img.height)
    upscale = plan['upscale']
    parts = []
    for top, bottom in plan['tiles']:
        seg = img.crop((0, top, img.width, bottom))
        if upscale > 1:
            seg = seg.resize((seg.width * upscale, seg.height * upscale), Image.LANCZOS)
        seg = seg.convert('RGB')
        buf = io.BytesIO()
        seg.save(buf, format='JPEG', quality=JPEG_QUALITY)
        parts.append(buf.getvalue())
    notes = ['图 %dx%d（高宽比 %.1f）' % (plan['width'], plan['height'],
                                       plan['height'] / float(plan['width']))]
    if upscale > 1:
        notes.append('放大 %d 倍到 %dpx 宽' % (upscale, plan['out_width']))
    notes.append('切 %d 段' % len(parts))
    if not plan['readable']:
        notes.append('原始宽度只有 %dpx，字迹可能已经不可辨认' % plan['width'])
    return parts, 'image/jpeg', '，'.join(notes) + '后识别'
