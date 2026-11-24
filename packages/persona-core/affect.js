'use strict';
/**
 * 出生技能 · 情绪/关系/主动控制器（B2-02）。
 *
 * 纯状态 + 规则，不调模型、不发消息：
 *  - affect：valence/arousal 衰减 + clamp；
 *  - relationship：0–100 关系分 + 档位；
 *  - proactive：总开关/静默时段/小时日配额/冷却/去重。
 */
const AFFECT = Object.freeze({ valence: [-1, 1], arousal: [0, 1], halfLifeMs: 30 * 60 * 1000 });
const PROACTIVE = Object.freeze({ maxPerHour: 3, maxPerDay: 10, cooldownMs: 10 * 60 * 1000, dedupeMs: 6 * 60 * 60 * 1000 });

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

function createAffect({ valence = 0, arousal = 0.3, updatedAt = 0 } = {}) {
  let v = clamp(Number(valence) || 0, -1, 1);
  let a = clamp(Number(arousal) || 0.3, 0, 1);
  let at = Number(updatedAt) || 0;
  function decay(now) {
    if (!at) { at = now; return; }
    if (now <= at) return;
    const k = Math.pow(0.5, (now - at) / AFFECT.halfLifeMs);
    v = v * k;
    a = 0.3 + (a - 0.3) * k;
    at = now;
  }
  function update({ deltaV = 0, deltaA = 0, at: now = Date.now() } = {}) {
    decay(now);
    v = clamp(v + (Number(deltaV) || 0), -1, 1);
    a = clamp(a + (Number(deltaA) || 0), 0, 1);
    at = now;
    return snapshot();
  }
  function snapshot(now = at) {
    if (now > at) decay(now);
    return { valence: Number(v.toFixed(3)), arousal: Number(a.toFixed(3)), label: label(v, a), updatedAt: at };
  }
  return { update, snapshot, decay };
}

function label(v, a) {
  if (v >= 0.3 && a >= 0.55) return '雀跃';
  if (v >= 0.2) return '高兴';
  if (v <= -0.4 && a >= 0.5) return '上火';
  if (v <= -0.2) return '低落';
  if (a >= 0.6) return '兴奋';
  return '日常';
}

function createRelationship({ score = 50 } = {}) {
  let s = clamp(Number(score) || 0, 0, 100);
  function touch(delta = 1) { s = clamp(s + Number(delta || 0), 0, 100); return snapshot(); }
  function level() {
    if (s >= 80) return '亲近';
    if (s >= 60) return '熟';
    if (s >= 40) return '普通';
    if (s >= 20) return '生疏';
    return '陌生';
  }
  function snapshot() { return { score: Math.round(s), level: level() }; }
  return { touch, level, snapshot };
}

function minuteOfDay(ms) {
  const d = new Date(ms);
  return d.getHours() * 60 + d.getMinutes();
}

function inQuiet(ms, quiet = { start: 23 * 60, end: 8 * 60 }) {
  const m = minuteOfDay(ms);
  const start = Number(quiet.start), end = Number(quiet.end);
  if (start === end) return false;
  if (start < end) return m >= start && m < end;
  return m >= start || m < end; // 跨午夜
}

function createProactive({ enabled = true, quiet = { start: 23 * 60, end: 8 * 60 }, maxPerHour = PROACTIVE.maxPerHour, maxPerDay = PROACTIVE.maxPerDay, cooldownMs = PROACTIVE.cooldownMs, dedupeMs = PROACTIVE.dedupeMs, now = () => Date.now() } = {}) {
  let on = Boolean(enabled);
  let sent = [];
  let lastAt = 0;
  let lastKey = '';
  function prune(ts) {
    const day = 86400000;
    sent = sent.filter((x) => ts - x.at < day);
    if (sent.length > 200) sent = sent.slice(-200);
  }
  function hourCount(ts) { return sent.filter((x) => ts - x.at < 3600000).length; }
  function dayCount(ts) { return sent.filter((x) => ts - x.at < 86400000).length; }
  function shouldSend({ text = '', key = '', at = now(), quiet: q = quiet } = {}) {
    if (!on) return { ok: false, reason: 'disabled' };
    const ts = Number(at);
    prune(ts);
    if (inQuiet(ts, q)) return { ok: false, reason: 'quiet' };
    if (lastAt && ts - lastAt < cooldownMs) return { ok: false, reason: 'cooldown' };
    if (hourCount(ts) >= maxPerHour) return { ok: false, reason: 'hour-cap' };
    if (dayCount(ts) >= maxPerDay) return { ok: false, reason: 'day-cap' };
    const k = String(key || text || '').trim();
    if (k && sent.some((x) => x.key === k && ts - x.at < dedupeMs)) return { ok: false, reason: 'duplicate' };
    return { ok: true, reason: 'ok' };
  }
  function record({ text = '', key = '', at = now() } = {}) {
    const ts = Number(at);
    sent.push({ at: ts, key: String(key || text || '').trim() });
    lastAt = ts;
    lastKey = String(key || text || '').trim();
    prune(ts);
    return snapshot(ts);
  }
  function setEnabled(value) { on = Boolean(value); }
  function snapshot(ts = now()) {
    prune(ts);
    return { enabled: on, sentHour: hourCount(ts), sentDay: dayCount(ts), lastAt, lastKey };
  }
  return { shouldSend, record, setEnabled, snapshot, inQuiet };
}

module.exports = { AFFECT, PROACTIVE, createAffect, createRelationship, createProactive, inQuiet, minuteOfDay };
