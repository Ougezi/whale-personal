'use strict';
/** I-02 工作/会话/指令接 prompt 自测。 */
const assert = require('node:assert');
const promptMemory = require('../../src/persona/promptMemory.js');
const features = require('../../src/infra/features.js');

let pass = 0, fail = 0;
function check(name, fn) {
  try { fn(); pass++; console.log('  ✓ ' + name); }
  catch (e) { fail++; console.log('  ✗ ' + name + '  ' + (e && e.message)); }
}
const on = { features: { workingMemory: true } };
const off = { features: { workingMemory: false } };

check('默认关闭', () => {
  assert.strictEqual(promptMemory.buildBlock({ chatId: 'a', msg: { text: 'x' }, config: off }), '');
  assert.strictEqual(features.isOn({ features: {} }, 'workingMemory'), false);
});

check('开启后出块', () => {
  promptMemory._reset();
  const b = promptMemory.buildBlock({ chatId: 'a', msg: { text: '查启动失败', chatType: 'private', ts: 1 }, config: on });
  assert.ok(b.includes('工作记忆'));
  assert.ok(b.includes('启动失败'));
});

check('含规则', () => {
  promptMemory._reset();
  const b = promptMemory.buildBlock({ chatId: 'a', msg: { text: 'x' }, config: on });
  assert.ok(b.includes('不冒充'));
});

check('含会话', () => {
  promptMemory._reset();
  promptMemory.buildBlock({ chatId: 'a', msg: { text: '第一' }, config: on });
  const b = promptMemory.buildBlock({ chatId: 'a', msg: { text: '第二' }, config: on });
  assert.ok(b.includes('第一') || b.includes('第二'));
});

check('按 chat 隔离', () => {
  promptMemory._reset();
  promptMemory.buildBlock({ chatId: 'a', msg: { text: 'A 的秘密' }, config: on });
  const b = promptMemory.buildBlock({ chatId: 'b', msg: { text: 'B' }, config: on });
  assert.ok(!b.includes('A 的秘密'));
});

check('预算内', () => {
  promptMemory._reset();
  const b = promptMemory.buildBlock({ chatId: 'a', msg: { text: 'x'.repeat(500) }, config: on });
  assert.ok(b.length <= promptMemory.MAX_BLOCK_CHARS);
});

check('主人关系行', () => {
  promptMemory._reset();
  const b = promptMemory.buildBlock({ chatId: 'a', msg: { text: 'x' }, isMaster: true, config: on });
  assert.ok(b.includes('主人'));
});

check('空消息不炸', () => {
  promptMemory._reset();
  assert.strictEqual(promptMemory.buildBlock({ chatId: 'a', msg: {}, config: on }), '');
});

console.log('\n通过 ' + pass + '/' + (pass + fail));
process.exit(fail ? 1 : 0);
