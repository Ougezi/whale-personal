'use strict';
/** I-06 eventSink 热停：enabled 运行期判断，关掉不写，开回来继续写。 */
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ChatStore } = require('../../src/memory/chatStore.js');
const { createEventSink } = require('../../src/memory/eventSink.js');

let pass = 0, fail = 0;
function check(name, fn) {
  try { fn(); pass++; console.log('  ✓ ' + name); }
  catch (e) { fail++; console.log('  ✗ ' + name + '  ' + (e && e.message)); }
}
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-i06-'));
const file = path.join(dir, 'events.jsonl');
let on = true;
const sink = createEventSink({ file, enabled: () => on });
const store = new ChatStore({ dir, eventSink: sink });
const chat = store.ensureChat('wechat:u:i06', { platform: 'wechat' });
function count() {
  try { return fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).length; } catch { return 0; }
}

check('开启时写事件', () => {
  store.appendMessage(chat, { role: 'user', text: '一' });
  assert.strictEqual(count(), 1);
});

check('关掉后停写', () => {
  on = false;
  store.appendMessage(chat, { role: 'user', text: '二' });
  assert.strictEqual(count(), 1);
});

check('停写不伤旧消息', () => {
  const legacy = fs.readFileSync(path.join(chat.dir, 'messages.jsonl'), 'utf8');
  assert.ok(legacy.includes('二'));
});

check('开回来继续写', () => {
  on = true;
  store.appendMessage(chat, { role: 'assistant', text: '三' });
  assert.strictEqual(count(), 2);
});

check('sink 返回 skipped', () => {
  on = false;
  const r = sink.append({ id: 'x', chatId: chat.chatId, role: 'user', text: 'x', ts: 1 }, chat);
  assert.strictEqual(r.skipped, true);
});

check('默认 enabled 为 true', () => {
  const f2 = path.join(dir, 'e2.jsonl');
  const s2 = createEventSink({ file: f2 });
  const r = s2.append({ id: 'y', chatId: 'c', role: 'user', text: 'y', ts: 1 }, { platform: 'wechat' });
  assert.strictEqual(r.duplicate, false);
});

check('切换多次稳定', () => {
  on = true;
  for (let i = 0; i < 3; i++) store.appendMessage(chat, { role: 'user', text: 'n' + i });
  on = false; store.appendMessage(chat, { role: 'user', text: 'off' });
  on = true; store.appendMessage(chat, { role: 'user', text: 'on' });
  assert.strictEqual(count(), 6);
});

console.log('\n通过 ' + pass + '/' + (pass + fail));
fs.rmSync(dir, { recursive: true, force: true });
process.exit(fail ? 1 : 0);
