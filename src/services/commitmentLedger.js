'use strict';
/** I-20：把 commitment.js 接进真实聊天承诺记录（默认关，record-only）。 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { createCommitmentLedger } = require('../../packages/memory-core/commitment.js');

const cache = new Map();

function fileFor(dataDir) { return path.join(dataDir, 'commitments.json'); }

function load(dataDir) {
  try {
    const rows = JSON.parse(fs.readFileSync(fileFor(dataDir), 'utf8'));
    return Array.isArray(rows) ? rows : [];
  } catch { return []; }
}

function save(dataDir, rows) {
  try {
    fs.mkdirSync(dataDir, { recursive: true });
    const file = fileFor(dataDir);
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(rows.slice(-500), null, 1), 'utf8');
    fs.renameSync(tmp, file);
  } catch { /* 记录失败不影响聊天 */ }
}

function ledgerFor(dataDir) {
  const key = path.resolve(String(dataDir || 'data'));
  if (cache.has(key)) return cache.get(key);
  const ledger = createCommitmentLedger();
  const ids = [];
  for (const row of load(key)) {
    try {
      ledger.add({ id: row.id, text: row.text, dueAt: row.dueAt, skill: row.skill });
      ids.push(row.id);
      for (const ev of row.evidence || []) ledger.addEvidence(row.id, ev);
      if (row.state === 'kept') ledger.resolve(row.id, row.createdAt || Date.now());
      else if (row.state === 'failed') ledger.resolve(row.id, (row.dueAt || 0) + 1);
    } catch { /* 单条坏数据跳过 */ }
  }
  const item = { ledger, ids, key };
  cache.set(key, item);
  return item;
}

function snapshot(dataDir) {
  const { ledger, ids } = ledgerFor(dataDir);
  return ids.map((id) => ledger.snapshot(id)).filter(Boolean);
}

function recordPromise({ dataDir, text, now = Date.now(), skill = 'care', dueAt = 0 } = {}) {
  const dir = String(dataDir || '').trim();
  const body = String(text || '').trim();
  if (!dir || !body) return null;
  const id = 'promise:' + now + ':' + crypto.createHash('sha1').update(body).digest('hex').slice(0, 8);
  const { ledger, ids } = ledgerFor(dir);
  const r = ledger.add({ id, text: body.slice(0, 200), dueAt, skill, evidenceRequired: true });
  if (!r.duplicate) ids.push(id);
  save(dir, snapshot(dir));
  return r.item;
}

function stats(dataDir) {
  const { ledger } = ledgerFor(dataDir);
  return ledger.stats();
}

function _reset() { cache.clear(); }

module.exports = { recordPromise, stats, snapshot, _reset };
