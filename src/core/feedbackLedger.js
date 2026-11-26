'use strict';
/** 反馈账本：保留原话，派生出可审计的偏好项。 */
const fs = require('node:fs');
const path = require('node:path');
const P = require('./expressionPrefs');

const BAN = /不喜欢|别发|不要发|不想看到|讨厌/;
const REDUCE = /少发|少一点|别老发|降低/;
const CLEAR = /可以发|没事了|不介意|发吧|可以了/;
function fileOf(dir) { return path.join(dir, 'self', 'feedback.jsonl'); }
function prefsFile(dir) { return path.join(dir, 'self', 'preferences.json'); }

function readPrefs(dir) {
  try { const d = JSON.parse(fs.readFileSync(prefsFile(dir), 'utf8')); return Array.isArray(d.items) ? d : { version: 1, items: [] }; }
  catch { return { version: 1, items: [] }; }
}
function writePrefs(dir, d) {
  try {
    fs.mkdirSync(path.dirname(prefsFile(dir)), { recursive: true });
    const tmp = prefsFile(dir) + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(d, null, 1), 'utf8');
    fs.renameSync(tmp, prefsFile(dir));
  } catch { /* 偏好账本失败不影响聊天 */ }
}
function modeOf(text) {
  const t = String(text || '');
  if (CLEAR.test(t)) return 'allow';
  if (BAN.test(t)) return 'ban';
  if (REDUCE.test(t)) return 'reduce';
  return '';
}
function record(dir, { text = '', chat = '', scope = 'master-private', at = Date.now() } = {}) {
  const t = String(text || '');
  const mode = modeOf(t);
  if (!mode) return { ok: false, reason: 'no-feedback' };
  const targets = P.emojisIn(t);
  if (/水滴/.test(t)) targets.push('💧');
  const uniq = [...new Set(targets)];
  if (!uniq.length) return { ok: false, reason: 'no-target' };
  const line = JSON.stringify({ at, chat, scope, text: t.slice(0, 200), mode, targets: uniq });
  try {
    fs.mkdirSync(path.dirname(fileOf(dir)), { recursive: true });
    fs.appendFileSync(fileOf(dir), line + '\n', 'utf8');
  } catch { return { ok: false, reason: 'write-failed' }; }
  const d = readPrefs(dir);
  for (const target of uniq) {
    const id = `${mode}:${target}:${scope}`;
    const old = d.items.find((x) => x.id === id);
    const item = {
      id, type: 'emoji', target, mode, scope, status: mode === 'allow' ? 'revoked' : 'active',
      confidence: mode === 'ban' ? 0.95 : 0.7, evidence: [line.slice(0, 180)],
      createdAt: old?.createdAt || at, confirmedAt: at,
    };
    d.items = [...d.items.filter((x) => x.id !== id), item];
  }
  writePrefs(dir, d);
  return { ok: true, mode, targets: uniq };
}
function list(dir) { return readPrefs(dir); }
module.exports = { fileOf, prefsFile, modeOf, record, list };
