'use strict';
/**
 * 主人的表达偏好：不喜欢哪些 emoji / 要不要少发。
 * 只做本地学习，不改模型权重；发送层和提示词同时遵守。
 */
const fs = require('node:fs');
const path = require('node:path');

const EMOJI_RE = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{1F1E6}-\u{1F1FF}\u{FE0F}]/gu;
const NEG = /不喜欢|少发|别发|不要发|不想看到|讨厌|别老发/;
const CLEAR = /可以发|没事了|不介意|发吧|可以了/;

function fileOf(dir) { return path.join(dir, 'self', 'expression.json'); }
function empty() { return { bannedEmojis: [], updated: 0 }; }
function load(dir) {
  try {
    const d = JSON.parse(fs.readFileSync(fileOf(dir), 'utf8'));
    return { bannedEmojis: Array.isArray(d.bannedEmojis) ? [...new Set(d.bannedEmojis.map(String).filter(Boolean))] : [], updated: Number(d.updated) || 0 };
  } catch { return empty(); }
}
function save(dir, d) {
  try {
    const f = fileOf(dir); fs.mkdirSync(path.dirname(f), { recursive: true });
    const tmp = f + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(d, null, 1), 'utf8'); fs.renameSync(tmp, f);
  } catch { /* 表达偏好写失败不影响聊天 */ }
  return d;
}
function emojisIn(text) { return String(text || '').match(EMOJI_RE) || []; }
function learn(dir, text) {
  const t = String(text || '');
  const d = load(dir);
  const before = new Set(d.bannedEmojis);
  if (NEG.test(t)) {
    for (const e of emojisIn(t)) d.bannedEmojis.push(e);
    if (/水滴/.test(t)) d.bannedEmojis.push('💧');
  }
  if (CLEAR.test(t)) {
    for (const e of emojisIn(t)) d.bannedEmojis = d.bannedEmojis.filter((x) => x !== e);
    if (/水滴/.test(t)) d.bannedEmojis = d.bannedEmojis.filter((x) => x !== '💧');
  }
  d.bannedEmojis = [...new Set(d.bannedEmojis)];
  const changed = d.bannedEmojis.length !== before.size || d.bannedEmojis.some((x) => !before.has(x));
  if (changed) { d.updated = Date.now(); save(dir, d); }
  return { changed, bannedEmojis: d.bannedEmojis };
}
function banned(dir) { return load(dir).bannedEmojis; }
function filterText(text, list) {
  const bad = new Set(list || []);
  if (!bad.size) return String(text || '');
  return String(text || '').replace(EMOJI_RE, (e) => bad.has(e) ? '' : e).trim();
}
function line(dir) {
  const list = banned(dir);
  if (!list.length) return '';
  return '【表达偏好】主人不喜欢这些：' + list.join(' ') + '。不要再发，也不要拿它当语气。';
}
module.exports = { EMOJI_RE, load, save, learn, banned, filterText, line, emojisIn };
