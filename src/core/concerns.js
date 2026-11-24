// 牵挂账本（R1，2026-11-23）：欠着的话、没做完的承诺，主动开口优先说
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const MAX_ITEMS = 50;
const DEFAULT_TTL = 7 * 86400000;   // 牵挂默认 7 天后自动关（没提就当过去了）

function fileOf(dataDir) { return path.join(dataDir, 'concerns.json'); }
function load(dataDir) {
  try {
    const d = JSON.parse(fs.readFileSync(fileOf(dataDir), 'utf8'));
    if (d && Array.isArray(d.items)) return d;
  } catch { /* 首次 */ }
  return { version: 1, items: [] };
}
function save(dataDir, data) {
  try {
    fs.mkdirSync(path.dirname(fileOf(dataDir)), { recursive: true });
    const tmp = fileOf(dataDir) + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data, null, 1), 'utf8');
    fs.renameSync(tmp, fileOf(dataDir));
    return true;
  } catch { return false; }
}

function add(dataDir, { text, kind = 'promise', dueAt = 0, now = Date.now() } = {}) {
  const body = String(text == null ? '' : text).replace(/\s+/g, ' ').trim().slice(0, 80);
  if (!body) return null;
  const data = load(dataDir);
  const exist = data.items.find((x) => !x.closed && x.text === body);
  if (exist) return exist;
  const item = { id: 'c_' + now.toString(36), text: body, kind, createdAt: now, dueAt: Number(dueAt) || (now + DEFAULT_TTL), closed: false };
  data.items = [...data.items, item].slice(-MAX_ITEMS);
  save(dataDir, data);
  return item;
}

function close(dataDir, key, now = Date.now()) {
  const data = load(dataDir);
  let hit = null;
  for (const x of data.items) {
    if (x.closed) continue;
    if (x.id === key || x.text === key || x.text.includes(String(key))) { x.closed = true; x.closedAt = now; hit = x; break; }
  }
  if (hit) save(dataDir, data);
  return hit;
}

function list(dataDir, { limit = 3, now = Date.now() } = {}) {
  const data = load(dataDir);
  let changed = false;
  for (const x of data.items) {
    if (!x.closed && x.dueAt && now > x.dueAt) { x.closed = true; x.closedAt = now; changed = true; }
  }
  if (changed) save(dataDir, data);
  return data.items.filter((x) => !x.closed).slice(-Math.max(1, Math.min(10, limit)));
}

function block({ dir = null, limit = 3, now = Date.now() } = {}) {
  if (!dir) return '';
  const items = list(dir, { limit, now });
  if (!items.length) return '';
  return `【欠着的】${items.map((x) => x.text).join('；')}（这些是你答应过或还没结局的事，合适的时候提一句，别硬催）`;
}

module.exports = { add, close, list, block, MAX_ITEMS };
