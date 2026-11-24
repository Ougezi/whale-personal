'use strict';
/** I-05 构建产物 E2E：dist 里的 ChatStore→事件、promptMemory 同时工作。 */
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const DIST = path.resolve(__dirname, '../../dist/whale-personal');
const { ChatStore } = require(path.join(DIST, 'src/memory/chatStore.js'));
const { createEventSink } = require(path.join(DIST, 'src/memory/eventSink.js'));
const promptMemory = require(path.join(DIST, 'src/persona/promptMemory.js'));
const features = require(path.join(DIST, 'src/infra/features.js'));

let pass = 0, fail = 0;
function check(name, fn) {
  try { fn(); pass++; console.log('  ✓ ' + name); }
  catch (e) { fail++; console.log('  ✗ ' + name + '  ' + (e && e.message)); }
}
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-i05-'));
const eventFile = path.join(dir, 'events.jsonl');
const store = new ChatStore({ dir, eventSink: createEventSink({ file: eventFile }) });
const chat = store.ensureChat('wechat:u:i05', { platform: 'wechat', chatType: 'private' });

check('dist ChatStore 可写', () => {
  store.appendMessage(chat, { role: 'user', text: '启动失败' });
  assert.ok(fs.readFileSync(path.join(chat.dir, 'messages.jsonl'), 'utf8').includes('启动失败'));
});
check('dist 事件旁路', () => {
  const rows = fs.readFileSync(eventFile, 'utf8').trim().split('\n').map(JSON.parse);
  assert.strictEqual(rows[0].type, 'message.received');
});
check('dist prompt block', () => {
  promptMemory._reset();
  const b = promptMemory.buildBlock({ chatId: 'c', msg: { text: '查日志' }, config: { features: { workingMemory: true } } });
  assert.ok(b.includes('工作记忆') && b.includes('查日志'));
});
check('dist prompt 默认关', () => {
  assert.strictEqual(promptMemory.buildBlock({ chatId: 'c', msg: { text: 'x' }, config: { features: {} } }), '');
});
check('dist feature 登记', () => {
  assert.ok(features.REGISTRY.some((f) => f.key === 'eventLog'));
  assert.ok(features.REGISTRY.some((f) => f.key === 'workingMemory'));
});
check('dist 事件 id 幂等', () => {
  const sink = createEventSink({ file: eventFile });
  const e = { id: 'msg_1', chatId: chat.chatId, seq: 1, role: 'user', text: '启动失败', ts: 1 };
  assert.strictEqual(sink.append(e, chat).duplicate, true);
});

console.log('\n通过 ' + pass + '/' + (pass + fail));
fs.rmSync(dir, { recursive: true, force: true });
process.exit(fail ? 1 : 0);
