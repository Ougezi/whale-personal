// 夜间"睡眠"：记忆整理（M3，2026-11-23）
// 每天凌晨 4 点后跑一次：矛盾失效、旧事归档、待确认教训晋升、产出洞察。
// 纯本地、同步、幂等；失败只记日志，不影响聊天。
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const personCard = require('../memory/personCard');
const innerNotes = require('../core/innerNotes');
const audit = require('../memory/audit');

const ARCHIVE_DAYS = 30;
const CONFLICT_SIM = 0.85;
const KW_MIN = 3;

function dayKey(now) { return new Date(now).toISOString().slice(0, 10); }
function reportFile(dataDir) { return path.join(dataDir, 'memory', 'sleep-report.json'); }
function archiveFile(dataDir) { return path.join(dataDir, 'memory', 'archive.md'); }
function insightsFile(dataDir) { return path.join(dataDir, 'inner', 'insights.md'); }

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

function writeAtomic(file, text) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, text, 'utf8');
    fs.renameSync(tmp, file);
    return true;
  } catch { return false; }
}

function walkCards(dataDir) {
  const base = path.join(dataDir, 'memory', 'chats');
  const out = [];
  let chats = [];
  try { chats = fs.readdirSync(base, { withFileTypes: true }); } catch { return out; }
  for (const chat of chats) {
    if (!chat.isDirectory()) continue;
    const pdir = path.join(base, chat.name, 'people');
    let people = [];
    try { people = fs.readdirSync(pdir, { withFileTypes: true }); } catch { continue; }
    for (const f of people) {
      if (!f.isFile() || !f.name.endsWith('.json')) continue;
      const file = path.join(pdir, f.name);
      const card = readJson(file);
      if (card) out.push({ file, card });
    }
  }
  return out;
}

/** 30 分钟一跳；同一天只跑一次，且 4 点后才跑 */
function maybeRun({ dataDir, now = Date.now(), logger = null, store = null } = {}) {
  if (!dataDir) return { ran: false, reason: 'no-data' };
  const day = dayKey(now);
  const prev = readJson(reportFile(dataDir));
  if (prev && prev.day === day) return { ...prev, ran: false, reason: 'already' };
  if (new Date(now).getHours() < 4) return { ran: false, reason: 'before-4' };
  try {
    return run({ dataDir, now, logger, store });
  } catch (err) {
    if (logger) logger.warn('记忆睡眠失败（不影响聊天）：' + (err && err.message ? err.message : String(err)));
    return { ran: false, reason: 'error' };
  }
}

function run({ dataDir, now = Date.now(), logger = null, store = null } = {}) {
  const report = { day: dayKey(now), at: now, ran: true, cards: 0, conflicted: 0, consolidated: 0, promoted: 0, insights: 0 };
  const archive = [];
  for (const { file, card } of walkCards(dataDir)) {
    const events = Array.isArray(card.events) ? card.events : [];
    let changed = false;
    // 1) 矛盾：同标题近重复，旧的那条失效（不删）
    for (let i = 0; i < events.length; i += 1) {
      const a = events[i];
      if (!a || a.validTo || a.deleted) continue;
      for (let j = i + 1; j < events.length; j += 1) {
        const b = events[j];
        if (!b || b.validTo || b.deleted) continue;
        if (personCard.normalizeText(a.title) !== personCard.normalizeText(b.title)) continue;
        if (personCard.similarity(a.summary || '', b.summary || '') < CONFLICT_SIM) continue;
        const older = (a.createdAt || 0) <= (b.createdAt || 0) ? a : b;
        const newer = older === a ? b : a;
        older.validTo = now;
        older.supersededBy = newer.id || null;
        report.conflicted += 1;
        changed = true;
        try { audit.append(dataDir, { kind: 'event', id: older.id, action: 'supersede', by: newer.id, reason: 'sleep' }); } catch { /* sleep-audit */ }
      }
    }
    // 2) 巩固：30 天以上、没被用过、不重要的 L1 事件归档（失效 + 留档）
    for (const e of events) {
      if (!e || e.validTo || e.deleted) continue;
      if (e.layer && e.layer !== 'L1') continue;
      if ((e.createdAt || 0) > now - ARCHIVE_DAYS * 86400000) continue;
      if (e.useCount) continue;
      if ((Number(e.importance) || 0) >= 0.5) continue;
      e.validTo = now;
      e.consolidated = true;
      report.consolidated += 1;
      changed = true;
      try { audit.append(dataDir, { kind: 'event', id: e.id, action: 'consolidate', reason: 'old-unused' }); } catch { /* sleep-audit */ }
      archive.push(`- [${String(e.date || '').slice(0, 10)}] ${String(e.title || '').slice(0, 20)}：${String(e.summary || '').slice(0, 100)}`);
    }
    if (changed) writeAtomic(file, JSON.stringify(card));
    report.cards += 1;
  }
  if (archive.length) {
    try {
      fs.mkdirSync(path.dirname(archiveFile(dataDir)), { recursive: true });
      fs.appendFileSync(archiveFile(dataDir), '\n' + archive.join('\n') + '\n', 'utf8');
    } catch { /* 归档失败只影响留档 */ }
  }
  // 3) 待确认教训：pending 超过 7 天视为确认
  report.promoted = innerNotes.promotePending({ kind: 'lessons', days: 7, now, dir: dataDir });
  // 4) 洞察
  report.insights = buildInsights(dataDir, now);
  writeAtomic(reportFile(dataDir), JSON.stringify(report, null, 1));
  // 卡是直接改磁盘的：不刷新内存缓存，下一条消息 saveCard 会把睡眠结果覆盖回去
  if (store && typeof store.refreshCards === 'function') {
    try { report.refreshed = store.refreshCards(); } catch { report.refreshed = 0; }
  }
  return report;
}

function buildInsights(dataDir, now) {
  let unresolved = 0;
  const kw = new Map();
  for (const { card } of walkCards(dataDir)) {
    for (const e of (Array.isArray(card.events) ? card.events : [])) {
      if (!e || e.validTo || e.deleted) continue;
      if (e.resolved === false) unresolved += 1;
      for (const k of (Array.isArray(e.keywords) ? e.keywords : [])) {
        const key = String(k || '').trim();
        if (key) kw.set(key, (kw.get(key) || 0) + 1);
      }
    }
  }
  const items = [];
  if (unresolved >= 3) items.push(`还有 ${unresolved} 件没结局的事，找机会问一句`);
  for (const [k, n] of [...kw.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3)) {
    if (n >= KW_MIN) items.push(`最近常提到「${k}」（${n} 次）`);
  }
  if (!items.length) return 0;
  let existing = '';
  try { existing = fs.readFileSync(insightsFile(dataDir), 'utf8'); } catch { /* 首次 */ }
  const stamp = new Date(now).toISOString().slice(5, 10);
  const lines = items.filter((t) => !existing.includes(t)).map((t) => `- [${stamp}] ${t}`);
  if (!lines.length) return 0;
  try {
    fs.mkdirSync(path.dirname(insightsFile(dataDir)), { recursive: true });
    fs.appendFileSync(insightsFile(dataDir), lines.join('\n') + '\n', 'utf8');
  } catch { return 0; }
  return lines.length;
}

module.exports = { run, maybeRun, ARCHIVE_DAYS };
