// 跨会话全局记忆（I2，2026-11-23）：同一个人在不同会话共享个人事实
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { shortId } = require('../memory/hash');

const MAX_FACTS = 50;
const MAX_UIDS = 500;

function dirOf(dataDir) { return path.join(dataDir, 'memory', 'people-global'); }
function fileOf(dataDir, uid) { return path.join(dirOf(dataDir), shortId('global|' + String(uid || '')) + '.json'); }

function load(dataDir, uid) {
  try {
    const d = JSON.parse(fs.readFileSync(fileOf(dataDir, uid), 'utf8'));
    if (d && Array.isArray(d.facts)) return d;
  } catch { /* 首次 */ }
  return { version: 1, uid: String(uid || ''), facts: [] };
}

function save(dataDir, uid, data) {
  try {
    fs.mkdirSync(dirOf(dataDir), { recursive: true });
    const tmp = fileOf(dataDir, uid) + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data, null, 1), 'utf8');
    fs.renameSync(tmp, fileOf(dataDir, uid));
    return true;
  } catch { return false; }
}

function addFact(dataDir, uid, text, { at = Date.now() } = {}) {
  const body = String(text == null ? '' : text).replace(/\s+/g, ' ').trim().slice(0, 80);
  if (!body || !uid) return null;
  const file = fileOf(dataDir, uid);
  if (!fs.existsSync(file)) {
    try {
      if (fs.readdirSync(dirOf(dataDir)).filter((x) => x.endsWith('.json')).length >= MAX_UIDS) return null;
    } catch { /* 目录还没建 */ }
  }
  const data = load(dataDir, uid);
  if (data.facts.some((f) => f.text === body)) return null;
  data.facts = [...data.facts, { text: body, at }].slice(-MAX_FACTS);
  save(dataDir, uid, data);
  return body;
}

function list(dataDir, uid, limit = 10) {
  return load(dataDir, uid).facts.slice(-Math.max(1, Math.min(MAX_FACTS, limit)));
}

function block({ dataDir = null, uid = '', limit = 5 } = {}) {
  if (!dataDir || !uid) return '';
  const facts = list(dataDir, uid, limit);
  if (!facts.length) return '';
  return `【跨会话印象】${facts.map((f) => f.text).join('；')}（这些是在别的会话里也成立的事）`;
}

module.exports = { addFact, list, block, MAX_FACTS };
