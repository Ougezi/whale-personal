'use strict';
/**
 * 主人的表达偏好：emoji 的 ban / reduce / allow。
 * 只做本地持久化，不改模型权重；prompt 和发送层都读它。
 */
const fs = require('node:fs');
const path = require('node:path');

const EMOJI_RE = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{1F1E6}-\u{1F1FF}\u{FE0F}]/gu;
const BAN = /不喜欢|别发|不要发|不想看到|讨厌/;
const REDUCE = /少发|少一点|别老发|降低/;
const CLEAR = /可以发|没事了|不介意|发吧|可以了/;

function fileOf(dir) { return path.join(dir, 'self', 'expression.json'); }
function empty() { return { bannedEmojis: [], reducedEmojis: [], updated: 0 }; }
function uniq(list) { return [...new Set((list || []).map(String).filter(Boolean))]; }
function load(dir) {
  try {
    const d = JSON.parse(fs.readFileSync(fileOf(dir), 'utf8'));
    return { bannedEmojis: uniq(d.bannedEmojis), reducedEmojis: uniq(d.reducedEmojis), updated: Number(d.updated) || 0 };
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
function targets(text) {
  const out = emojisIn(text);
  if (/水滴/.test(String(text || ''))) out.push('💧');
  return uniq(out);
}
function learn(dir, text) {
  const t = String(text || '');
  const d = load(dir);
  const before = JSON.stringify([d.bannedEmojis, d.reducedEmojis]);
  const list = targets(t);
  if (CLEAR.test(t)) {
    d.bannedEmojis = d.bannedEmojis.filter((x) => !list.includes(x));
    d.reducedEmojis = d.reducedEmojis.filter((x) => !list.includes(x));
  } else if (BAN.test(t)) {
    d.bannedEmojis = uniq([...d.bannedEmojis, ...list]);
    d.reducedEmojis = d.reducedEmojis.filter((x) => !d.bannedEmojis.includes(x));
  } else if (REDUCE.test(t)) {
    d.reducedEmojis = uniq([...d.reducedEmojis, ...list]);
    d.bannedEmojis = d.bannedEmojis.filter((x) => !d.reducedEmojis.includes(x));
  }
  const changed = JSON.stringify([d.bannedEmojis, d.reducedEmojis]) !== before;
  if (changed) { d.updated = Date.now(); save(dir, d); }
  return { changed, bannedEmojis: d.bannedEmojis, reducedEmojis: d.reducedEmojis };
}
function banned(dir) { return load(dir).bannedEmojis; }
function reduced(dir) { return load(dir).reducedEmojis; }
function filterText(text, list) {
  const bad = new Set(list || []);
  if (!bad.size) return String(text || '');
  return String(text || '').replace(EMOJI_RE, (e) => bad.has(e) ? '' : e).trim();
}
function line(dir) {
  const d = load(dir);
  const parts = [];
  if (d.bannedEmojis.length) parts.push('不喜欢：' + d.bannedEmojis.join(' ') + '（不要发）');
  if (d.reducedEmojis.length) parts.push('少发：' + d.reducedEmojis.join(' ') + '（降低频率，不是完全禁）');
  return parts.length ? '【表达偏好】主人' + parts.join('；') + '。' : '';
}
module.exports = { EMOJI_RE, load, save, learn, banned, reduced, filterText, line, emojisIn };
