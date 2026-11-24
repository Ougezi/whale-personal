'use strict';
/** I-12：features 去重 / promptMemory LRU / 事件轮转。 */
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const features = require('../../src/infra/features.js');
const promptMemory = require('../../src/persona/promptMemory.js');
const { createEventSink } = require('../../src/memory/eventSink.js');
const { rotate } = require('../../src/infra/jsonlRetention.js');

let pass = 0, fail = 0;
function check(name, fn) {
  try { fn(); pass++; console.log('  ✓ ' + name); }
  catch (e) { fail++; console.log('  ✗ ' + name + '  ' + (e && e.message)); }
}

check('features 29 个唯一键', () => assert.strictEqual(features.REGISTRY.length, 29));
check('features 无重复', () => {
  const keys = features.REGISTRY.map((x) => x.key);
  assert.strictEqual(new Set(keys).size, keys.length);
});
check('mood/thoughts/browse 各一次', () => {
  const keys = features.REGISTRY.map((x) => x.key);
  for (const k of ['mood', 'thoughts', 'browse']) assert.strictEqual(keys.filter((x) => x === k).length, 1);
});
check('开关列表键唯一', () => {
  const list = features.list({ features: {} });
  assert.strictEqual(new Set(list.map((x) => x.key)).size, list.length);
});

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-i12-'));
const big = path.join(dir, 'events.jsonl');
fs.writeFileSync(big, 'x'.repeat(5 * 1024 * 1024 + 1));
check('大文件触发轮转', () => assert.strictEqual(rotate(big, { maxBytes: 5 * 1024 * 1024 }), true));
check('生成 .1 历史', () => assert.ok(fs.existsSync(big + '.1')));

const file = path.join(dir, 'events2.jsonl');
const sink = createEventSink({ file, enabled: true });
sink.append({ id: 'm1', chatId: 'c1', role: 'user', text: 'hi', ts: 1 }, { platform: 'wechat' });
check('事件 id 不再双前缀', () => {
  const f = path.join(dir, 'id.jsonl');
  const s2 = createEventSink({ file: f, enabled: true });
  s2.append({ id: 'm9', chatId: 'wechat:u:x', role: 'user', text: 'x', ts: 1 }, { platform: 'wechat' });
  const line = JSON.parse(fs.readFileSync(f, 'utf8').trim());
  assert.strictEqual(line.id, 'wechat:u:x:m9');
  assert.ok(!line.id.includes('chat:chat'));
});

check('轮转后事件仍可写', () => assert.ok(fs.readFileSync(file, 'utf8').includes('m1')));

promptMemory._reset();
const cfg = { features: { workingMemory: true } };
for (let i = 0; i < 70; i++) promptMemory.buildBlock({ chatId: 'c' + i, msg: { text: 'x' }, config: cfg });
check('LRU 上限 64', () => assert.ok(promptMemory._size() <= promptMemory.MAX_STORES));
check('LRU 保留最近 64', () => assert.strictEqual(promptMemory._size(), 64));
check('老 chat 被淘汰', () => {
  const before = promptMemory._size();
  promptMemory.buildBlock({ chatId: 'c0', msg: { text: 'again' }, config: cfg });
  assert.strictEqual(promptMemory._size(), before);
});
check('关闭 feature 返回空', () => assert.strictEqual(promptMemory.buildBlock({ chatId: 'x', msg: { text: 'x' }, config: { features: { workingMemory: false } } }), ''));

console.log('\n通过 ' + pass + '/' + (pass + fail));
fs.rmSync(dir, { recursive: true, force: true });
process.exit(fail ? 1 : 0);
