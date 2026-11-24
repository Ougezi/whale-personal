// 记忆审计（S3，2026-11-23）：写入/失效/删除/晋升都留痕
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const MAX_LINES = 2000;

function fileOf(dataDir) {
  return path.join(dataDir, 'memory', 'audit.jsonl');
}

function append(dataDir, entry) {
  try {
    const file = fileOf(dataDir);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, JSON.stringify({ at: Date.now(), ...entry }) + '\n', 'utf8');
    trim(file);
    return true;
  } catch {
    return false;
  }
}

function trim(file) {
  try {
    const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);
    if (lines.length > MAX_LINES + 200) {
      fs.writeFileSync(file, lines.slice(-MAX_LINES).join('\n') + '\n', 'utf8');
    }
  } catch { /* 审计只是旁路 */ }
}

function recent(dataDir, limit = 50) {
  try {
    const lines = fs.readFileSync(fileOf(dataDir), 'utf8').split('\n').filter(Boolean);
    return lines.slice(-Math.max(1, Math.min(500, Number(limit) || 50)))
      .map((line) => { try { return JSON.parse(line); } catch { return null; } })
      .filter(Boolean);
  } catch {
    return [];
  }
}

module.exports = { append, recent, fileOf, MAX_LINES };
