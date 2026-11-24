'use strict';
/**
 * 事件向量索引（P4）
 *
 * 事件正文 → 向量 → 落盘缓存（data/vector/event-vecs.json）。
 * 用「正文哈希」当 key：事件被重写就自然失效，不需要跟卡片里的 id 绑死。
 * 量化存 Int8（512 维 ≈ 512 字节），400 条事件 ≈ 200KB。
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const embed = require('../core/embed');

const ROOT = path.resolve(__dirname, '..', '..');
const CACHE_FILE = path.join(ROOT, 'data', 'vector', 'event-vecs.json');
let cache = null;
let dirty = false;

function keyOf(text) {
  return crypto.createHash('sha1').update(String(text || '').slice(0, 600)).digest('hex').slice(0, 16);
}

function loadCache() {
  if (cache) return cache;
  try {
    cache = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
    if (!cache || typeof cache !== 'object') cache = {};
  } catch {
    cache = {};
  }
  return cache;
}

function saveCache() {
  if (!dirty) return;
  try {
    fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
    const tmp = CACHE_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(cache), 'utf8');
    fs.renameSync(tmp, CACHE_FILE);
    dirty = false;
  } catch {
    // 缓存写不进去只影响下次重算，不影响本轮
  }
}

function quantize(vec) {
  const buf = Buffer.alloc(vec.length);
  for (let i = 0; i < vec.length; i += 1) {
    const q = Math.max(-127, Math.min(127, Math.round(vec[i] * 127)));
    buf.writeInt8(q, i);
  }
  return buf.toString('base64');
}

function dequantize(b64) {
  const buf = Buffer.from(b64, 'base64');
  const out = new Float32Array(buf.length);
  for (let i = 0; i < buf.length; i += 1) out[i] = buf.readInt8(i) / 127;
  return out;
}

/**
 * 取一批文本的向量（有缓存用缓存，缺的现算并落盘）。
 * 嵌入不可用 / 失败 → 返回 null，调用方退回 BM25。
 */
async function getVectors(texts, { logger = null } = {}) {
  if (!embed.available()) return null;
  const list = (Array.isArray(texts) ? texts : []).map((t) => String(t || ''));
  if (!list.length) return [];
  const c = loadCache();
  const missing = [];
  for (const t of list) {
    const k = keyOf(t);
    if (!c[k]) missing.push(t);
  }
  if (missing.length) {
    const vecs = await embed.embed(missing, { logger });
    if (vecs && vecs.length === missing.length) {
      for (let i = 0; i < missing.length; i += 1) {
        c[keyOf(missing[i])] = quantize(vecs[i]);
        dirty = true;
      }
      saveCache();
    } else if (!vecs) {
      return null;
    }
  }
  return list.map((t) => {
    const b = c[keyOf(t)];
    return b ? dequantize(b) : null;
  });
}

/** 单条查询向量 */
async function getQueryVector(text, opts = {}) {
  if (!embed.available()) return null;
  const vecs = await embed.embed([text], opts);
  return vecs && vecs[0] ? Float32Array.from(vecs[0]) : null;
}

/** 缓存状态（自测用） */
function stats() {
  const c = loadCache();
  return { entries: Object.keys(c).length, file: CACHE_FILE };
}

module.exports = {
  CACHE_FILE, getVectors, getQueryVector, stats, keyOf, quantize, dequantize, CACHE_FILE };
