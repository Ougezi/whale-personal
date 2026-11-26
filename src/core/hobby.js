'use strict';
/**
 * 兴趣爱好账本（P0/P1）
 * 兴趣 = 领域 + 证据 + 强度 + 阶段 + 表达边界；没有 ref 的证据不收。
 * 纯状态函数，文件 IO 在 services/hobby.js。
 */
const fs = require('node:fs');
const path = require('node:path');

const VERSION = 1;
const MAX_ATTACHED = 3;
const MAX_EXPLORING = 2;
const EVIDENCE_MAX = 50;
const KINDS = new Set(['self-disclosure', 'owner-shared', 'browse-hit', 'platform-read', 'diary-reflection', 'practice-log']);
const DOMAINS = new Set(['collect', 'smell', 'sound', 'image', 'text', 'anime', 'animal', 'food', 'world', 'tech', 'language', 'body', 'nature', 'film', 'play', 'culture', 'travel', 'story', 'memory']);

const SEEDS = [
  { id: 'collect-small-things', name: '攒小东西', domain: 'collect', status: 'seed', strength: 70, source: '真实聊天：票根/贴纸/糖纸/小纸条' },
  { id: 'rain-smell', name: '雨后的味道', domain: 'smell', status: 'seed', strength: 58, source: '真实聊天：想闻雨后湿润干净的味道' },
  { id: 'small-notes', name: '手写小纸条', domain: 'text', status: 'seed', strength: 52, source: '真实聊天：盒子里有自己写的小纸条' },
];

function dayKey(now = Date.now()) {
  const d = new Date(now); const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function empty(now = Date.now()) {
  return { version: VERSION, interests: SEEDS.map((s) => ({ ...s, curiosity: 50, competence: 10, social: 30, createdAt: now, lastEvidenceAt: 0, evidence: [], boundaries: { canClaimOwned: s.id !== 'rain-smell', canClaimVisited: false, canSpend: false }, expression: { maxMentionsPerDay: 2, avoidRepeatTurns: 6 } })), meta: { lastTickAt: 0, day: dayKey(now), mentions: {} } };
}

function normalize(doc, now = Date.now()) {
  const base = empty(now);
  if (!doc || typeof doc !== 'object') return base;
  const byId = new Map((Array.isArray(doc.interests) ? doc.interests : []).map((x) => [String(x.id || ''), x]));
  const interests = base.interests.map((seed) => ({ ...seed, ...(byId.get(seed.id) || {}), evidence: Array.isArray((byId.get(seed.id) || {}).evidence) ? byId.get(seed.id).evidence.slice(-EVIDENCE_MAX) : [] }));
  // 只接受已声明的兴趣，不凭 tags 现场造新领域
  return { version: VERSION, interests, meta: { ...base.meta, ...(doc.meta || {}), day: String((doc.meta || {}).day || dayKey(now)) } };
}

function load(dir) {
  try { return normalize(JSON.parse(fs.readFileSync(path.join(dir, 'interests.json'), 'utf8'))); }
  catch { return empty(); }
}

function save(dir, doc) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, 'interests.json'); const tmp = file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(normalize(doc), null, 1), 'utf8'); fs.renameSync(tmp, file);
  } catch { /* 兴趣写失败不影响聊天 */ }
  return doc;
}

function observe(doc, { kind, ref, at = Date.now(), weight = 1, tags = [], name = '', domain = '' } = {}) {
  const d = normalize(doc, at);
  if (!KINDS.has(String(kind)) || !ref) return { changed: false, reason: 'evidence-required' };
  const w = Math.max(1, Math.min(5, Number(weight) || 1));
  const tagSet = new Set((Array.isArray(tags) ? tags : []).map(String));
  let it = d.interests.find((x) => tagSet.has(x.id) || tagSet.has(x.domain) || (name && x.name === name) || (domain && x.domain === domain));
  if (!it) return { changed: false, reason: 'unknown-interest' };
  if ((it.evidence || []).some((e) => e.ref === String(ref))) return { changed: false, reason: 'duplicate-ref', state: d };
  if (it.status === 'dormant') it.status = 'exploring';
  it.evidence = [...(it.evidence || []), { kind, ref: String(ref).slice(0, 200), at, weight: w }].slice(-EVIDENCE_MAX);
  it.lastEvidenceAt = at;
  it.strength = Math.max(0, Math.min(100, (it.strength || 0) + w));
  const n = it.evidence.filter((e) => e.kind !== 'fake').length;
  if (it.strength >= 70 && n >= 3 && it.status !== 'attached') {
    if (d.interests.filter((x) => x.status === 'attached').length >= MAX_ATTACHED) return { changed: false, reason: 'max-attached' };
    it.status = 'attached';
  } else if (it.strength >= 50 && n >= 2 && it.status === 'seed') it.status = 'exploring';
  return { changed: true, interest: it, state: d };
}

function tick(doc, now = Date.now()) {
  const d = normalize(doc, now);
  for (const it of d.interests) {
    const days = it.lastEvidenceAt ? (now - it.lastEvidenceAt) / 86400000 : 0;
    if (days >= 30) it.status = 'dormant';
    else if (days >= 14) it.status = 'cooling';
    else if (days >= 7) it.strength = Math.max(0, it.strength - 3);
  }
  d.meta.lastTickAt = now; d.meta.day = dayKey(now);
  return d;
}

function promptLine(doc, { max = 3 } = {}) {
  const d = normalize(doc);
  const list = d.interests
    .filter((x) => ['seed', 'attached', 'practicing', 'exploring'].includes(x.status))
    .sort((a, b) => (b.strength || 0) - (a.strength || 0))
    .slice(0, Math.max(1, Math.min(3, max)));
  if (!list.length) return '';
  return '【我的兴趣】\n' + list.map((x) => {
    const how = x.status === 'exploring' ? '还在了解' : '喜欢';
    const claim = x.boundaries?.canClaimOwned ? '只说自己真的留着的，不编新买' : '只说想了解，不编经历';
    return `- ${x.name}：${how}；${claim}；不声称刚写完/拍完/去过/买过`;
  }).join('\n');
}

function pickTopic(doc, desire = '') {
  const d = normalize(doc);
  const map = { 见: 'image', 听: 'sound', 香: 'smell', 味: 'food', 触: 'animal', 意: 'text' };
  const domain = map[String(desire)] || '';
  return d.interests.filter((x) => ['seed', 'attached', 'practicing', 'exploring'].includes(x.status) && (!domain || x.domain === domain)).sort((a, b) => (b.strength || 0) - (a.strength || 0))[0] || null;
}

const KEYWORDS = [
  { id: 'collect-small-things', re: /票根|贴纸|糖纸|小东西|盒子|攒|收藏/ },
  { id: 'rain-smell', re: /雨后|下雨|湿润|闻|香气|味道/ },
  { id: 'small-notes', re: /小纸条|纸条|手写|写字|文字|写过/ },
];

function detectTags(text) {
  const s = String(text || '');
  if (/不喜欢|没兴趣|不感兴趣/.test(s)) return [];
  return KEYWORDS.filter((k) => k.re.test(s)).map((k) => k.id);
}

function detectEvidence(text, role = 'user') {
  const tags = detectTags(text);
  if (!tags.length) return { tags: [], kind: '', weight: 0 };
  if (role === 'assistant') {
    // 只收她明确说“我...”的自我披露；她复述/提问不算自己的兴趣。
    const self = /我(?:的)?(?:盒子|留着|攒|写过|收藏|想闻|想听)/.test(String(text || ''));
    return self ? { tags, kind: 'self-disclosure', weight: 2 } : { tags: [], kind: '', weight: 0 };
  }
  return { tags, kind: 'owner-shared', weight: 1 };
}

module.exports = { VERSION, SEEDS, empty, load, save, normalize, observe, tick, promptLine, pickTopic, detectTags, detectEvidence };
