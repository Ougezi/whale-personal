'use strict';
/** I-34：真实迁移（owner 授权）：源 messages.jsonl 只读，写独立 .migration.jsonl。 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {
  sha256File, parseMessages, toEvent, migrateJsonl, verifyMigration, rollback,
} = require('../../packages/memory-core/migrate.js');

function arg(name, def = '') {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}
const ROOT = path.resolve(__dirname, '..', '..');
const DATA = path.join(ROOT, 'dist', 'whale-personal', 'data');
const chatId = arg('chat');
const owner = arg('owner');
const confirm = process.argv.includes('--confirm');
if (!chatId || !owner || !confirm) {
  console.error('usage: node 鲸鲸-主链真实迁移.js --chat <chatId> --owner <name> --confirm');
  process.exit(2);
}
const safe = crypto.createHash('sha1').update(chatId).digest('hex').slice(0, 12);
const messagesFile = path.join(DATA, 'memory', 'chats', safe, 'messages.jsonl');
// 从 chats/*/meta.json 找 chatId，兼容目录 hash 与 chatId 不同
let sourceFile = messagesFile;
if (!fs.existsSync(sourceFile)) {
  const base = path.join(DATA, 'memory', 'chats');
  for (const d of fs.existsSync(base) ? fs.readdirSync(base) : []) {
    try {
      const m = JSON.parse(fs.readFileSync(path.join(base, d, 'meta.json'), 'utf8'));
      if (String(m.chatId) === chatId) sourceFile = path.join(base, d, 'messages.jsonl');
    } catch { /* skip */ }
  }
}
if (!fs.existsSync(sourceFile)) { console.error('messages.jsonl not found for ' + chatId); process.exit(3); }
const before = sha256File(sourceFile);
const messages = parseMessages(sourceFile);
const targetDir = path.join(DATA, 'migration');
fs.mkdirSync(targetDir, { recursive: true });
const target = path.join(targetDir, safe + '.migration.jsonl');
if (fs.existsSync(target)) {
  const backup = target + '.bak-migrate-' + Date.now();
  fs.copyFileSync(target, backup);
  console.log('target backup:', backup);
}
const result = migrateJsonl({ messagesFile: sourceFile, eventFile: target, chatId, dryRun: false });
const verify = verifyMigration({ messagesFile: sourceFile, eventFile: target, chatId });
const after = sha256File(sourceFile);
const sourceUnchanged = before === after;
const ok = result.ok && verify.ok && sourceUnchanged;
if (!ok) {
  try { rollback({ eventFile: target }); } catch { /* ignore */ }
  console.log(JSON.stringify({ ok: false, reason: 'verify/source failed; target rolled back', result, verify, sourceUnchanged }, null, 1));
  process.exit(4);
}
console.log(JSON.stringify({
  ok: true, owner, chatId, source: sourceFile, target,
  sourceRows: messages.length, sourceHash: before, sourceUnchanged,
  added: result.added, duplicate: result.duplicate, events: result.events,
  verify,
}, null, 1));
