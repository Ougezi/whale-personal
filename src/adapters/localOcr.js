'use strict';

/**
 * 本地 OCR 兜底：没配视觉 Key（或视觉接口失败）时，用 Windows 自带 OCR 读出图上的字。
 * 不需要任何 Key；读不到文字就返回空字符串，让调用方决定怎么跟用户解释。
 */

const { execFile } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const PYTHON = path.join(ROOT, 'runtime', 'python', 'python.exe');
const SCRIPT = path.join(ROOT, 'scripts', 'ocr_image.py');

const MIME_EXT = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/webp': '.webp',
  'image/bmp': '.bmp',
  'image/gif': '.gif',
};

function available() {
  return fs.existsSync(PYTHON) && fs.existsSync(SCRIPT);
}

function ocrFile(filePath, { timeoutMs = 20000 } = {}) {
  return new Promise((resolve, reject) => {
    execFile(PYTHON, [SCRIPT, filePath], { timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => {
      if (err && !stdout) return reject(err);
      try {
        const out = JSON.parse(String(stdout).trim().split('\n').pop());
        if (!out || out.ok !== true) return reject(new Error((out && out.error) || 'OCR 失败'));
        resolve(String(out.text || ''));
      } catch (parseErr) {
        reject(parseErr);
      }
    });
  });
}

/** imageBase64 → 图上文字（没有任何文字就返回 ''） */
async function ocrBase64(imageBase64, mime = 'image/jpeg', opts = {}) {
  if (!available()) throw new Error('本机没有 OCR 组件（缺 runtime/python 或 scripts/ocr_image.py）');
  const clean = String(imageBase64 || '').replace(/^data:[^,]*,/, '').replace(/\s+/g, '');
  if (!clean) throw new Error('没有图片数据');
  const tmp = path.join(os.tmpdir(), 'whale-ocr-' + Date.now() + '-' + Math.random().toString(16).slice(2, 8) + (MIME_EXT[mime] || '.jpg'));
  fs.writeFileSync(tmp, Buffer.from(clean, 'base64'));
  try {
    return await ocrFile(tmp, opts);
  } finally {
    try { fs.unlinkSync(tmp); } catch { /* 临时文件删不掉不影响结果 */ }
  }
}

module.exports = { available, ocrFile, ocrBase64 };