'use strict';
/** I-01 主链事件双写自测：开着写事件、关着不写、失败不伤旧聊天。 */
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ChatStore } = require('../../src/memory/chatStore.js');
const { createEventSink } = require('../../src/memory/eventSink.js');
const features = require('../../src/infra/features.js');

let pass = 0, fail = 0;
function check(name, fn) {
  try { fn(); pass++; console.log('  ✓ ' + name); }
  catch (e) { fail++; console.log('  ✗ ' + name + '  ' + (e && e.message)); }
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-i01-'));
const eventFile = path.join(dir, 'events.jsonl');
const store = new ChatStore({ dir, eventSink: createEventSink({ file: eventFile }) });
const chat = store.ensureChat('wechat:u:i01', { platform: 'wechat', chatType: 'private' });

check('旧消息仍然写入', () => {
  const e = store.appendMessage(chat, { role: 'user', name: '主人', text: '你好' });
  assert.strictEqual(e.text, '你好');
  const legacy = fs.readFileSync(path.join(chat.dir, 'messages.jsonl'), 'utf8');
  assert.ok(legacy.includes('你好'));
});

check('事件旁路写入', () => {
  const rows = fs.readFileSync(eventFile, 'utf8').trim().split('\n').map(JSON.parse);
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].type, 'message.received');
  assert.strictEqual(rows[0].scope.visibility, 'private');
  assert.deepStrictEqual(rows[0].evidence, ['msg_1']);
});

check('assistant 事件类型', () => {
  store.appendMessage(chat, { role: 'assistant', text: '在' });
  const rows = fs.readFileSync(eventFile, 'utf8').trim().split('\n').map(JSON.parse);
  assert.strictEqual(rows[1].type, 'message.sent');
});

check('默认开关关闭', () => {
  assert.strictEqual(features.isOn({ features: {} }, 'eventLog'), false);
  assert.strictEqual(features.REGISTRY.some((f) => f.key === 'eventLog'), true);
});

check('显式开启', () => {
  assert.strictEqual(features.isOn({ features: { eventLog: true } }, 'eventLog'), true);
});

check('sink 失败不伤旧链', () => {
  const d2 = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-i01-bad-'));
  const s2 = new ChatStore({ dir: d2, eventSink: { append() { throw new Error('disk'); } } });
  const c2 = s2.ensureChat('wechat:u:bad', { platform: 'wechat' });
  const e = s2.appendMessage(c2, { role: 'user', text: '还在' });
  assert.strictEqual(e.text, '还在');
  assert.ok(fs.readFileSync(path.join(c2.dir, 'messages.jsonl'), 'utf8').includes('还在'));
});

check('不注入 sink 无事件文件', () => {
  const d3 = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-i01-off-'));
  const s3 = new ChatStore({ dir: d3 });
  const c3 = s3.ensureChat('wechat:u:off', { platform: 'wechat' });
  s3.appendMessage(c3, { role: 'user', text: '旧行为' });
  assert.strictEqual(fs.existsSync(path.join(d3, 'memory-events.jsonl')), false);
});

check('事件 id 稳定幂等', () => {
  const sink = createEventSink({ file: eventFile });
  const c = store.ensureChat('wechat:u:i01', { platform: 'wechat' });
  const e = { id: 'msg_1', chatId: c.chatId, seq: 1, role: 'user', name: '主人', text: '你好', ts: 1 };
  assert.strictEqual(sink.append(e, c).duplicate, true);
});

console.log('\n通过 ' + pass + '/' + (pass + fail));
fs.rmSync(dir, { recursive: true, force: true });
process.exit(fail ? 1 : 0);
