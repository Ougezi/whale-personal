'use strict';
/** B1-04 迁移/双写自测。 */
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createEventStore } = require('../../packages/memory-core/events.js');
const { migrateJsonl, verifyMigration, createDualWriter, rollback, sha256File } = require('../../packages/memory-core/migrate.js');

let pass = 0, fail = 0;
function check(name, fn) {
  try { fn(); pass++; console.log('  ✓ ' + name); }
  catch (e) { fail++; console.log('  ✗ ' + name + '  ' + (e && e.message)); }
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-migrate-'));
const messagesFile = path.join(dir, 'messages.jsonl');
const rows = [
  { id: 'msg_0', seq: 0, role: 'user', text: '启动失败', ts: 1000 },
  { id: 'msg_1', seq: 1, role: 'assistant', text: '我看看', ts: 2000 },
  { id: 'msg_2', seq: 2, role: 'user', text: '好', ts: 3000 },
  { id: 'msg_3', seq: 3, role: 'assistant', text: '找到日志了', ts: 4000 },
  { id: 'msg_4', seq: 4, role: 'user', text: '谢谢', ts: 5000 },
];
fs.writeFileSync(messagesFile, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
const sourceHash = sha256File(messagesFile);

check('迁移 5 条', () => {
  const r = migrateJsonl({ messagesFile, chatId: 'wxid_test' });
  assert.strictEqual(r.source, 5);
  assert.strictEqual(r.events, 5);
  assert.strictEqual(r.added, 5);
  assert.strictEqual(r.missing, 0);
  assert.ok(r.sourceUnchanged);
  assert.strictEqual(r.sourceHash, sourceHash);
});

check('重复迁移 0 新增', () => {
  const r = migrateJsonl({ messagesFile, chatId: 'wxid_test' });
  assert.strictEqual(r.events, 5);
  assert.strictEqual(r.added, 0);
  assert.strictEqual(r.duplicate, 5);
});

check('迁移后源文件未变', () => {
  assert.strictEqual(sha256File(messagesFile), sourceHash);
});

check('verify 通过', () => {
  const r = verifyMigration({ messagesFile, eventFile: path.join(dir, 'wxid_test.migration.jsonl'), chatId: 'wxid_test' });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.events, 5);
});

check('dry-run 不写', () => {
  const f = path.join(dir, 'dry.migration.jsonl');
  const r = migrateJsonl({ messagesFile, eventFile: f, chatId: 'dry', dryRun: true });
  assert.strictEqual(r.added, 5);
  assert.strictEqual(fs.existsSync(f), false);
});

check('坏行跳过', () => {
  const f = path.join(dir, 'bad.jsonl');
  fs.writeFileSync(f, JSON.stringify(rows[0]) + '\n{broken\n' + JSON.stringify(rows[1]) + '\n');
  const r = migrateJsonl({ messagesFile: f, chatId: 'bad' });
  assert.strictEqual(r.source, 2);
  assert.strictEqual(r.events, 2);
});

check('双写都成功', () => {
  const f = path.join(dir, 'dual.migration.jsonl');
  const store = createEventStore({ file: f });
  const legacy = [];
  const w = createDualWriter({ legacyAppend: (m) => legacy.push(m), eventStore: store, mapEvent: (m) => ({ id: 'd1', type: 'message.received', at: 1, source: {}, scope: {}, payload: m }) });
  const r = w({ text: 'x' });
  assert.strictEqual(legacy.length, 1);
  assert.strictEqual(r.event.duplicate, false);
});

check('事件失败不伤旧链', () => {
  const bad = { append() { throw new Error('disk full'); } };
  const legacy = [];
  const w = createDualWriter({ legacyAppend: (m) => legacy.push(m), eventStore: bad, mapEvent: (m) => m });
  const r = w({ text: 'y' });
  assert.strictEqual(legacy.length, 1);
  assert.ok(r.error && /disk full/.test(r.error.message));
});

check('rollback 删迁移文件', () => {
  const f = path.join(dir, 'rb.migration.jsonl');
  fs.writeFileSync(f, 'x');
  assert.strictEqual(rollback({ eventFile: f }).removed, true);
  assert.strictEqual(fs.existsSync(f), false);
});

check('rollback 拒绝非迁移文件', () => {
  const f = path.join(dir, 'messages.jsonl');
  assert.throws(() => rollback({ eventFile: f }));
});

check('旧聊天文件仍在', () => {
  assert.strictEqual(fs.existsSync(messagesFile), true);
  assert.strictEqual(sha256File(messagesFile), sourceHash);
});

console.log('\n通过 ' + pass + '/' + (pass + fail));
fs.rmSync(dir, { recursive: true, force: true });
process.exit(fail ? 1 : 0);
