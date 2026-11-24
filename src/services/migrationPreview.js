'use strict';
/** I-22：migrate dry-run；只读预览，不写目标。 */
const fs = require('node:fs');
const path = require('node:path');
const { parseMessages, toEvent, sha256File } = require('../../packages/memory-core/migrate.js');

function safePath(p) {
  const abs = path.resolve(String(p || ''));
  const data = path.resolve(path.join(process.cwd(), 'data'));
  return abs.startsWith(data + path.sep) || abs === data;
}

function preview({ messagesFile, chatId, platform = 'wechat', limit = 5 } = {}) {
  const file = path.resolve(String(messagesFile || ''));
  if (!file || !fs.existsSync(file)) return { ok: false, error: 'messagesFile missing' };
  if (!safePath(file)) return { ok: false, error: 'path outside data/' };
  if (!String(chatId || '').trim()) return { ok: false, error: 'chatId required' };
  const messages = parseMessages(file);
  const events = messages.map((m) => toEvent(m, { chatId, platform }));
  return {
    ok: true, dryRun: true, source: file,
    sourceHash: sha256File(file), rows: messages.length, events: events.length,
    target: path.join(path.dirname(file), String(chatId) + '.migration.jsonl'),
    samples: events.slice(0, Math.max(1, Math.min(20, Number(limit) || 5))).map((e) => ({
      id: e.id, type: e.type, at: e.at, role: e.payload.role, text: String(e.payload.text).slice(0, 80),
    })),
  };
}

module.exports = { preview };
