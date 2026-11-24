'use strict';
/**
 * 出生技能 · 记忆核心：混合检索与重构。
 *
 * 参考：
 *  - mem0：BM25 + 语义 + entity/threshold + score_and_rank；
 *  - dsh-fish-soul：RRF(k=60)、时间意图、泛词不计内容、缺失向量 0.85 补偿、fail-open。
 *
 * 只做检索/重构；不写记忆，不调模型。
 */
const LIMITS = Object.freeze({
  rrfK: 60,
  vectorMissing: 0.85,
  recencyBoost: 1.5,
  mmrLambda: 0.7,
  confidenceThreshold: 0.35,
  maxCandidates: 50,
  defaultTopK: 6,
  defaultBudgetChars: 900,
});

const GENERIC = new Set(['那个', '这个', '那些', '这些', '什么', '怎么', '怎样', '为什么', '谁', '哪里', '哪', '多少', '几个', '说的', '讲的', '东西', '事情', '一下']);
const STOP = new Set(['的', '了', '是', '在', '和', '与', '就', '都', '也', '有', '我', '你', '他', '她', '它', '吗', '呢', '啊', '吧']);
const TIME_DAYS = [['刚刚才', 1], ['刚才', 1], ['刚刚', 1], ['方才', 1], ['上次', 3], ['上回', 3], ['最近', 3], ['近期', 3]];

function tokens(text) {
  const s = String(text || '').toLowerCase();
  const out = [];
  for (const m of s.matchAll(/[a-z0-9_]+/g)) out.push(m[0]);
  const han = s.replace(/[^\u4e00-\u9fff]/g, '');
  for (let i = 0; i < han.length; i++) {
    if (i + 1 < han.length) out.push(han.slice(i, i + 2));
    if (han.length <= 1) out.push(han[i]);
  }
  return [...new Set(out.filter((t) => !STOP.has(t) && !GENERIC.has(t)))];
}

function bm25(query, items, { k1 = 1.2, b = 0.75 } = {}) {
  const q = tokens(query);
  const docs = items.map((it) => tokens([it.summary, it.text, it.content].filter(Boolean).join(' ')));
  const N = docs.length || 1;
  const avg = docs.reduce((n, d) => n + d.length, 0) / N || 1;
  const df = new Map();
  for (const d of docs) for (const t of new Set(d)) df.set(t, (df.get(t) || 0) + 1);
  const scores = docs.map((d, i) => {
    const tf = new Map();
    for (const t of d) tf.set(t, (tf.get(t) || 0) + 1);
    let score = 0;
    for (const t of q) {
      const f = tf.get(t) || 0;
      if (!f) continue;
      const idf = Math.log(1 + (N - (df.get(t) || 0) + 0.5) / ((df.get(t) || 0) + 0.5));
      score += idf * (f * (k1 + 1)) / (f + k1 * (1 - b + b * (d.length / avg)));
    }
    return { id: items[i].id, score };
  });
  const max = Math.max(0, ...scores.map((s) => s.score));
  return new Map(scores.map((s) => [s.id, max > 0 ? s.score / max : 0]));
}

function cosine(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || !a.length || !b.length) return null;
  const n = Math.min(a.length, b.length);
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i];
  }
  return na && nb ? dot / (Math.sqrt(na) * Math.sqrt(nb)) : null;
}

function vectorScores(queryVec, items, bm25Map) {
  return new Map(items.map((it) => {
    const c = cosine(queryVec, it.vector);
    return [it.id, c === null ? LIMITS.vectorMissing * (bm25Map.get(it.id) || 0) : Math.max(0, c)];
  }));
}

function timeIntentDays(query) {
  const s = String(query || '');
  for (const [word, days] of TIME_DAYS) if (s.includes(word)) return days;
  return 0;
}

function scopeOk(item, scope) {
  if (!scope) return true;
  return item.scope === undefined || item.scope === scope || item.scope === 'global';
}

function hasEvidence(item) {
  return Array.isArray(item.evidence) && item.evidence.length > 0;
}

function jaccard(a, b) {
  const A = new Set(tokens(a)), B = new Set(tokens(b));
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter += 1;
  return inter / (A.size + B.size - inter);
}

function mmr(items, k, lambda = LIMITS.mmrLambda) {
  const picked = [];
  const pool = items.slice();
  while (picked.length < k && pool.length) {
    let best = -1, bestScore = -Infinity;
    for (let i = 0; i < pool.length; i++) {
      const rel = pool[i].score;
      const div = picked.length ? Math.max(...picked.map((p) => jaccard(p.text + p.summary, pool[i].text + pool[i].summary))) : 0;
      const v = lambda * rel - (1 - lambda) * div;
      if (v > bestScore) { bestScore = v; best = i; }
    }
    picked.push(pool.splice(best, 1)[0]);
  }
  return picked;
}

function hybridSearch(query, items, opts = {}) {
  const scope = opts.scope;
  const now = opts.now || Date.now();
  const topK = opts.topK || LIMITS.defaultTopK;
  const all = (items || [])
    .filter((it) => it && it.id && scopeOk(it, scope))
    .filter((it) => (it.kind === 'semantic' ? hasEvidence(it) : true));
  if (!all.length) return { items: [], answerable: false, reason: 'no-candidates', confidence: 0, query };
  const bm = bm25(query, all);
  const vec = vectorScores(opts.vector, all, bm);
  const rank = (map) => [...all.map((it) => ({ id: it.id, s: map.get(it.id) || 0 }))].sort((a, b) => b.s - a.s).map((x) => x.id);
  const bmRank = new Map(rank(bm).map((id, i) => [id, i + 1]));
  const vecRank = new Map(rank(vec).map((id, i) => [id, i + 1]));
  const days = timeIntentDays(query);
  const scored = all.map((it) => {
    const rrf = 1 / (LIMITS.rrfK + (bmRank.get(it.id) || 999)) + 1 / (LIMITS.rrfK + (vecRank.get(it.id) || 999));
    const ageDays = Math.max(0, (now - Number(it.at || 0)) / 86400000);
    const recent = days > 0 && ageDays <= days ? LIMITS.recencyBoost : 1;
    const importance = Math.max(0, Math.min(1, Number(it.importance ?? 0.5)));
    const evidence = hasEvidence(it) ? 1 : 0;
    const bmScore = bm.get(it.id) || 0;
    const vecScore = vec.get(it.id) || 0;
    const relevant = bmScore > 0 || vecScore > 0;
    let score = relevant ? (rrf + 0.12 * importance + 0.10 * evidence) * recent : 0;
    if (relevant && it.conflict) score += 0.01;
    return { ...it, score, bm25: bmScore, vector: vecScore, evidenceOk: Boolean(evidence) };
  }).sort((a, b) => b.score - a.score);
  const max = scored[0] ? scored[0].score : 0;
  const normalized = scored.map((s) => ({ ...s, score: max > 0 ? s.score / max : 0 }));
  const picked = mmr(normalized, topK);
  const top = picked[0];
  const confidence = top ? Math.min(1, 0.7 * top.score + 0.3 * (top.evidenceOk ? 1 : 0)) : 0;
  const answerable = Boolean(top) && top.score > 0 && confidence >= LIMITS.confidenceThreshold && (top.kind !== 'semantic' || top.evidenceOk);
  return { items: picked, answerable, reason: answerable ? 'ok' : (top ? 'low-confidence' : 'no-hit'), confidence, query };
}

function reconstruct(result, { budgetChars = LIMITS.defaultBudgetChars } = {}) {
  if (!result || !result.answerable) {
    return { text: '', notRemember: true, evidence: [], reason: result ? result.reason : 'no-result' };
  }
  const lines = [];
  const evidence = [];
  let used = 0;
  for (const it of result.items) {
    const line = '[' + it.id + '] ' + String(it.summary || it.text || '').replace(/\s+/g, ' ').slice(0, 220);
    if (used + line.length + 1 > budgetChars) break;
    lines.push(line);
    used += line.length + 1;
    if (Array.isArray(it.evidence)) evidence.push(...it.evidence);
  }
  return { text: lines.join('\n'), notRemember: false, evidence: [...new Set(evidence)], reason: 'ok', count: lines.length };
}

module.exports = { LIMITS, tokens, bm25, cosine, hybridSearch, reconstruct, timeIntentDays, mmr };
