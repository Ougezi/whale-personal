# -*- coding: utf-8 -*-
"""本地 OCR：用 Windows 自带的 OCR 引擎读图上的文字（不需要任何 Key）。
用法：python ocr_image.py <图片路径>
输出：{"ok": true, "text": "..."} 或 {"ok": false, "error": "..."}
"""
import asyncio
import json
import sys

async def run(path):
    from winsdk.windows.media.ocr import OcrEngine
    from winsdk.windows.storage import StorageFile, FileAccessMode
    from winsdk.windows.graphics.imaging import BitmapDecoder

    engine = OcrEngine.try_create_from_user_profile_languages()
    if engine is None:
        return {"ok": False, "error": "系统没有可用的 OCR 语言包（设置 → 时间和语言 → 语言，装一下中文 OCR）"}
    f = await StorageFile.get_file_from_path_async(path)
    stream = await f.open_async(FileAccessMode.READ)
    decoder = await BitmapDecoder.create_async(stream)
    bitmap = await decoder.get_software_bitmap_async()
    result = await engine.recognize_async(bitmap)
    lines = [line.text for line in result.lines if line.text]
    return {"ok": True, "text": "\n".join(lines), "lines": len(lines)}

def main():
    if len(sys.argv) < 2:
        print(json.dumps({"ok": False, "error": "缺少图片路径"}))
        return
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass
    try:
        out = asyncio.run(run(sys.argv[1]))
    except Exception as exc:  # noqa: BLE001
        out = {"ok": False, "error": "%s: %s" % (type(exc).__name__, exc)}
    print(json.dumps(out, ensure_ascii=False))

if __name__ == "__main__":
    main()