// 技能结晶（I4，2026-11-23）：成功做过的事，留一条"以后怎么做"
'use strict';

const fs = require('node:fs');
const path = require('node:path');

function fileOf(dataDir) { return path.join(dataDir, 'skills.md'); }

function add(dataDir, text, { at = Date.now() } = {}) {
  const body = String(text == null ? '' : text).replace(/\s+/g, ' ').trim().slice(0, 120);
  if (!body) return false;
  try {
    let existing = '';
    try { existing = fs.readFileSync(fileOf(dataDir), 'utf8'); } catch { /* 首次 */ }
    if (existing.includes(body)) return false;
    fs.mkdirSync(path.dirname(fileOf(dataDir)), { recursive: true });
    const stamp = new Date(at).toISOString().slice(5, 10);
    fs.appendFileSync(fileOf(dataDir), `- [${stamp}] ${body}\n`, 'utf8');
    return true;
  } catch { return false; }
}

function list(dataDir, limit = 8) {
  try {
    return fs.readFileSync(fileOf(dataDir), 'utf8').split('\n').filter(Boolean).slice(-limit);
  } catch { return []; }
}

/** 关键词匹配：给派活前提示用 */
function match(dataDir, text, limit = 3) {
  const t = String(text || '');
  if (!t) return [];
  // 中文按 2 字滑窗算重叠，英文按词
  const grams = new Set();
  for (let i = 0; i + 1 < t.length; i += 1) {
    const g = t.slice(i, i + 2);
    if (/^[\u4e00-\u9fff]{2}$/.test(g)) grams.add(g);
  }
  for (const w of (t.match(/[a-zA-Z_]{3,20}/g) || [])) grams.add(w.toLowerCase());
  return list(dataDir, 50)
    .map((line) => ({ line, score: [...grams].filter((g) => line.toLowerCase().includes(g)).length }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => x.line);
}

module.exports = { add, list, match };
