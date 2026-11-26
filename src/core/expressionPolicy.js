'use strict';
/**
 * 表达策略唯一出口：emoji 的 ban / reduce / allow 都在这里算。
 * chat 里不再各自维护 emoji 列表。
 */
const fs = require('node:fs');
const path = require('node:path');

const BASE_EMOJIS = Object.freeze(['🐋', '🥺', '😭', '✨', '💧', '🫧', '🍚']);
const REDUCED_CHANCE = 0.05;

function policyFrom(prefs = {}) {
  return {
    banned: new Set(prefs.bannedEmojis || []),
    reduced: new Map((prefs.reducedEmojis || []).map((e) => [e, REDUCED_CHANCE])),
  };
}
function allowed(emoji, p) { return Boolean(emoji) && !p.banned.has(emoji); }
function chance(emoji, p, base = 1) {
  if (!allowed(emoji, p)) return 0;
  return p.reduced.has(emoji) ? Math.min(base, p.reduced.get(emoji)) : base;
}
function filterBanned(text, p) {
  if (!p || !p.banned.size) return String(text || '');
  return String(text || '').replace(/\p{Extended_Pictographic}/gu, (e) => p.banned.has(e) ? '' : e).trim();
}
function pool(list, p) { return (list || []).filter((e) => allowed(e, p)); }
function pickRandom(list, p, rng = Math.random) {
  const allowedList = pool(list, p);
  if (!allowedList.length) return '';
  const weights = allowedList.map((e) => p.reduced.has(e) ? REDUCED_CHANCE : 1);
  const total = weights.reduce((a, b) => a + b, 0);
  let r = (typeof rng === 'function' ? rng() : Math.random()) * total;
  for (let i = 0; i < allowedList.length; i++) {
    r -= weights[i];
    if (r <= 0) return allowedList[i];
  }
  return allowedList[allowedList.length - 1];
}
function shouldKeep(emoji, p, rng = Math.random) {
  if (!allowed(emoji, p)) return false;
  if (!p.reduced.has(emoji)) return true;
  return (typeof rng === 'function' ? rng() : Math.random()) < p.reduced.get(emoji);
}
function shufflePick(list, p, rng = Math.random) { return pickRandom(list, p, rng); }
function fromPreferences(doc, { scope = 'master-private' } = {}) {
  const banned = [], reduced = [];
  const want = String(scope || 'master-private');
  for (const it of (doc && Array.isArray(doc.items) ? doc.items : [])) {
    if (!it || it.status !== 'active') continue;
    const sc = String(it.scope || 'master-private');
    if (sc !== want && sc !== 'global') continue;
    if (it.mode === 'ban') banned.push(it.target);
    if (it.mode === 'reduce') reduced.push(it.target);
  }
  return policyFrom({ bannedEmojis: banned, reducedEmojis: reduced });
}
function load(dir, { scope = 'master-private' } = {}) {
  try {
    const d = JSON.parse(fs.readFileSync(path.join(dir, 'self', 'preferences.json'), 'utf8'));
    if (Array.isArray(d.items) && d.items.length) return fromPreferences(d, { scope });
  } catch { /* fallback legacy */ }
  try {
    const legacy = JSON.parse(fs.readFileSync(path.join(dir, 'self', 'expression.json'), 'utf8'));
    return policyFrom({ bannedEmojis: legacy.bannedEmojis || [], reducedEmojis: legacy.reducedEmojis || [] });
  } catch { return policyFrom({}); }
}
function line(policy) {
  const banned = [...(policy?.banned || [])];
  const reduced = [...(policy?.reduced?.keys?.() || [])];
  const parts = [];
  if (banned.length) parts.push('不喜欢：' + banned.join(' ') + '（不要发）');
  if (reduced.length) parts.push('少发：' + reduced.join(' ') + '（降低频率，不是完全禁）');
  return parts.length ? '【表达偏好】主人' + parts.join('；') + '。' : '';
}

module.exports = { BASE_EMOJIS, REDUCED_CHANCE, policyFrom, fromPreferences, load, line, allowed, chance, filterBanned, pool, pickRandom, shouldKeep, shufflePick };
