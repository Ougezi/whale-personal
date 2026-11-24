'use strict';
/**
 * 出生技能 · 记忆迁移/双写（B1-04）。
 *
 * 铁律：
 *  - 旧 messages.jsonl 只读，不改、不删；
 *  - 迁移写独立事件文件（默认 <chat>.migration.jsonl），可整文件回滚；
 *  - event.id 幂等，重复迁移 duplicate 不增；
 *  - 双写先写旧链；事件写失败只记错误，不阻断旧链。
 */
const fs = require('node:fs');
const path = require('node:path');
const { createEventStore } = require('./events.js');

function sha256File(file) {
  const crypto = require('node:crypto');
  const h = crypto.createHash('sha256');
  const b = fs.readFileSync(file);
  h.update(b);
  return h.digest('hex');
}

function parseMessages(file) {
  const raw = fs.readFileSync(file, 'utf8');
  const out = [];
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const m = JSON.parse(line);
      if (m && m.role && m.text !== undefined) out.push(m);
    } catch { /* 坏行跳过，不迁 */ }
  }
  return out;
}

function toEvent(message, { chatId, platform = 'wechat' } = {}) {
  const seq = Number(message.seq) || 0;
  const id = String(message.id || `msg_${seq}`);
  return {
    id: `chat:${chatId}:${id}`,
    type: message.role === 'assistant' ? 'message.sent' : 'message.received',
    at: Number(message.ts) || 0,
    source: { kind: 'chat', ref: String(message.msgId || id) },
    scope: { platform, chat: chatId, visibility: 'private' },
    payload: {
      role: message.role,
      text: String(message.text || '').slice(0, 4000),
      seq,
      name: message.name || '',
    },
    evidence: [String(message.id || `msg_${seq}`)],
  };
}

function migrateJsonl({ messagesFile, eventFile, chatId, platform = 'wechat', dryRun = false } = {}) {
  if (!messagesFile || !chatId) throw new Error('messagesFile/chatId required');
  if (!fs.existsSync(messagesFile)) throw new Error('messagesFile missing');
  const before = sha256File(messagesFile);
  const messages = parseMessages(messagesFile);
  const target = eventFile || path.join(path.dirname(messagesFile), chatId + '.migration.jsonl');
  const store = createEventStore({ file: target });
  const beforeIds = new Set(store.readAll().map((e) => e.id));
  let added = 0, duplicate = 0;
  for (const m of messages) {
    const ev = toEvent(m, { chatId, platform });
    if (dryRun) {
      if (beforeIds.has(ev.id)) duplicate += 1; else added += 1;
      continue;
    }
    const r = store.append(ev);
    if (r.duplicate) duplicate += 1; else added += 1;
  }
  const after = sha256File(messagesFile);
  const events = store.readAll();
  const expected = new Set(messages.map((m) => toEvent(m, { chatId, platform }).id));
  const got = new Set(events.map((e) => e.id));
  const missing = [...expected].filter((id) => !got.has(id));
  return {
    ok: before === after && missing.length === 0,
    dryRun,
    source: messages.length,
    events: events.length,
    added, duplicate, missing: missing.length,
    sourceUnchanged: before === after,
    sourceHash: before,
    eventFile: target,
  };
}

function verifyMigration({ messagesFile, eventFile, chatId, platform = 'wechat' } = {}) {
  const messages = parseMessages(messagesFile);
  const store = createEventStore({ file: eventFile });
  const got = new Set(store.readAll().map((e) => e.id));
  const expected = messages.map((m) => toEvent(m, { chatId, platform }).id);
  const missing = expected.filter((id) => !got.has(id));
  return { ok: missing.length === 0, source: messages.length, events: got.size, missing: missing.length };
}

function createDualWriter({ legacyAppend, eventStore, mapEvent, onError } = {}) {
  if (typeof legacyAppend !== 'function' || !eventStore) throw new Error('legacyAppend/eventStore required');
  return function dualWrite(message) {
    const legacy = legacyAppend(message);
    let event = null, error = null;
    try {
      event = eventStore.append(mapEvent ? mapEvent(message) : message);
    } catch (e) {
      error = e;
      if (typeof onError === 'function') onError(e);
    }
    return { legacy, event, error };
  };
}

function rollback({ eventFile, expectedSuffix = '.migration.jsonl' } = {}) {
  if (!eventFile || !eventFile.endsWith(expectedSuffix)) throw new Error('refuse to delete non-migration file');
  if (!fs.existsSync(eventFile)) return { ok: true, removed: false };
  fs.unlinkSync(eventFile);
  return { ok: true, removed: true };
}

module.exports = { sha256File, parseMessages, toEvent, migrateJsonl, verifyMigration, createDualWriter, rollback };
