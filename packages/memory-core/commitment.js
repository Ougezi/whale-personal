'use strict';
/**
 * 出生技能 · 承诺与能力（B5-03）。
 *
 * 承诺三态：open → kept / failed
 *  - kept 必须有 evidence；
 *  - 到期无证据 → failed；
 *  - 能力不是自夸：同类 kept ≥3 次才写进能力表。
 */
const MIN_WINS = 3;

function createCommitmentLedger({ minWins = MIN_WINS, now = Date.now } = {}) {
  const items = new Map();
  function add({ id, text = '', dueAt = 0, skill = 'other', evidenceRequired = true } = {}) {
    if (!id) throw new Error('commitment id required');
    if (!String(text).trim()) throw new Error('text required');
    if (items.has(id)) return { duplicate: true, item: snapshot(id) };
    items.set(id, { id, text: String(text).slice(0, 500), dueAt: Number(dueAt) || 0, skill: String(skill || 'other'), state: 'open', evidence: [], createdAt: now() });
    return { duplicate: false, item: snapshot(id) };
  }
  function addEvidence(id, ref) {
    const c = items.get(id);
    if (!c) throw new Error('unknown commitment: ' + id);
    if (c.state !== 'open') throw new Error('terminal commitment: ' + c.state);
    const e = String(ref || '').trim();
    if (!e) throw new Error('evidence required');
    if (!c.evidence.includes(e)) c.evidence.push(e);
    return snapshot(id);
  }
  function resolve(id, at = now()) {
    const c = items.get(id);
    if (!c) throw new Error('unknown commitment: ' + id);
    if (c.state !== 'open') return snapshot(id);
    if (c.evidence.length > 0) c.state = 'kept';
    else if (c.dueAt && at >= c.dueAt) c.state = 'failed';
    return snapshot(id);
  }
  function due(at = now(), withinMs = 24 * 3600 * 1000) {
    return [...items.values()].filter((c) => c.state === 'open' && c.dueAt && c.dueAt - at <= withinMs).map((c) => snapshot(c.id));
  }
  function competence() {
    const by = new Map();
    for (const c of items.values()) {
      if (!by.has(c.skill)) by.set(c.skill, { skill: c.skill, kept: 0, failed: 0 });
      const g = by.get(c.skill);
      if (c.state === 'kept' && c.evidence.length) g.kept += 1;
      if (c.state === 'failed') g.failed += 1;
    }
    return [...by.values()].filter((g) => g.kept >= minWins).map((g) => ({ ...g, capable: true, rate: Number((g.kept / Math.max(1, g.kept + g.failed)).toFixed(2)) }));
  }
  function snapshot(id) {
    const c = items.get(id);
    return c ? { ...c, evidence: [...c.evidence] } : null;
  }
  function stats() {
    const out = { open: 0, kept: 0, failed: 0 };
    for (const c of items.values()) out[c.state] = (out[c.state] || 0) + 1;
    return { ...out, capabilities: competence().map((c) => c.skill) };
  }
  return { add, addEvidence, resolve, due, competence, snapshot, stats, minWins };
}

module.exports = { MIN_WINS, createCommitmentLedger };
