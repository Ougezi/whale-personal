// 记忆体检（M4，2026-11-23）：重复、无来源、断卡、超限
// 只读扫描，不改数据；给 health / 命令行共用。
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const personCard = require('./personCard');

const S2_CUTOFF = new Date(2026, 10, 23).getTime();   // 本地 11-23 零点；之前的老数据不算缺来源

function walkCards(dataDir) {
  const base = path.join(dataDir, 'memory', 'chats');
  const out = [];
  let chats = [];
  try { chats = fs.readdirSync(base, { withFileTypes: true }); } catch { return out; }
  for (const chat of chats) {
    if (!chat.isDirectory()) continue;
    const pdir = path.join(base, chat.name, 'people');
    let files = [];
    try { files = fs.readdirSync(pdir, { withFileTypes: true }); } catch { continue; }
    for (const f of files) {
      if (!f.isFile() || !f.name.endsWith('.json')) continue;
      const file = path.join(pdir, f.name);
      try {
        const card = JSON.parse(fs.readFileSync(file, 'utf8'));
        out.push({ file, card });
      } catch {
        out.push({ file, broken: true });
      }
    }
  }
  return out;
}

function scan({ dataDir, dupSim = 0.9 } = {}) {
  const report = { cards: 0, events: 0, dups: 0, noSource: 0, legacyNoSource: 0, broken: 0, overLimit: 0, ok: true };
  for (const item of walkCards(dataDir)) {
    if (item.broken) { report.broken += 1; continue; }
    const card = item.card || {};
    report.cards += 1;
    const events = Array.isArray(card.events) ? card.events.filter((e) => e && !e.deleted && !e.validTo) : [];
    report.events += events.length;
    for (const e of events) {
      if (!e.source || !e.source.kind) {
        if ((Number(e.createdAt) || 0) >= S2_CUTOFF) report.noSource += 1;
        else report.legacyNoSource += 1;
      }
    }
    for (let i = 0; i < events.length; i += 1) {
      for (let j = i + 1; j < events.length; j += 1) {
        if (personCard.normalizeText(events[i].title) !== personCard.normalizeText(events[j].title)) continue;
        if (personCard.similarity(events[i].summary || '', events[j].summary || '') >= dupSim) report.dups += 1;
      }
    }
    if ((Array.isArray(card.preferences) ? card.preferences.length : 0) > 48
      || (Array.isArray(card.events) ? card.events.length : 0) > 400) report.overLimit += 1;
  }
  report.ok = report.broken === 0 && report.noSource === 0 && report.overLimit === 0 && report.dups <= 5;
  return report;
}

module.exports = { scan, walkCards, S2_CUTOFF };
