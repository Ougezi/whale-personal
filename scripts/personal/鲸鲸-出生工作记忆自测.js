'use strict';
/** B1-02 工作/会话/指令记忆自测。 */
const assert = require('node:assert');
const { createWorkingMemory, createSessionMemory, createInstructionMemory, resolvePointer, LIMITS } = require('../../packages/memory-core/working.js');

let pass = 0, fail = 0;
function check(name, fn) {
  try { fn(); pass++; console.log('  ✓ ' + name); }
  catch (e) { fail++; console.log('  ✗ ' + name + '  ' + (e && e.message)); }
}

check('working 7 槽', () => {
  const w = createWorkingMemory();
  for (let i = 0; i < 8; i++) w.set('k' + i, 'v' + i, i);
  assert.strictEqual(w.snapshot().slots.length, 7);
  assert.strictEqual(w.get('k0'), '');
  assert.strictEqual(w.get('k7'), 'v7');
});

check('working 1000 字上限', () => {
  const w = createWorkingMemory();
  for (let i = 0; i < 7; i++) w.set('k' + i, 'x'.repeat(300), i);
  assert.ok(w.snapshot().chars <= 1000, String(w.snapshot().chars));
});

check('working 覆盖同 key', () => {
  const w = createWorkingMemory();
  w.set('topic', 'a');
  w.set('topic', 'b');
  assert.strictEqual(w.get('topic'), 'b');
  assert.strictEqual(w.snapshot().slots.length, 1);
});

check('session 12 条上限', () => {
  const s = createSessionMemory();
  for (let i = 0; i < 14; i++) s.add({ id: 'm' + i, text: 't' + i, at: i });
  assert.strictEqual(s.snapshot().messages.length, 12);
  assert.strictEqual(s.latest().id, 'm13');
});

check('session 任务+预算', () => {
  const s = createSessionMemory();
  s.add({ id: 'm1', text: 'hello' });
  s.setTask('查启动失败');
  const snap = s.snapshot();
  assert.strictEqual(snap.task, '查启动失败');
  assert.ok(snap.tokens > 0);
});

check('instruction owner 最高', () => {
  const i = createInstructionMemory();
  i.add({ id: 'tone', source: 'default', text: '默认' });
  i.add({ id: 'tone', source: 'config', text: '配置' });
  i.add({ id: 'tone', source: 'owner', text: '主人' });
  assert.strictEqual(i.resolve()[0].text, '主人');
});

check('instruction 规则数上限', () => {
  const i = createInstructionMemory({ maxRules: 3 });
  for (let n = 0; n < 5; n++) i.add({ id: 'r' + n, source: 'config', text: 'r' + n });
  assert.ok(i.count() <= 3);
});

check('instruction 拒绝事实来源', () => {
  const i = createInstructionMemory();
  assert.throws(() => i.add({ id: 'x', source: 'memory', text: '事实' }));
});

check('instruction scope', () => {
  const i = createInstructionMemory();
  i.add({ id: 'g', source: 'config', text: '全局', scope: 'global' });
  i.add({ id: 'grp', source: 'owner', text: '群规', scope: 'group' });
  assert.strictEqual(i.resolve('group').length, 2);
  assert.strictEqual(i.resolve('private').length, 1);
});

check('指代解析', () => {
  const w = createWorkingMemory();
  w.set('topic', '启动失败');
  const hit = resolvePointer('刚才那个查一下', w, createSessionMemory());
  assert.deepStrictEqual(hit, { kind: 'working', key: 'topic', text: '启动失败' });
});

check('无指代不猜', () => {
  const w = createWorkingMemory();
  w.set('topic', '启动失败');
  assert.strictEqual(resolvePointer('今天天气', w, createSessionMemory()), null);
});

check('预算估算', () => {
  assert.ok(LIMITS.workingChars === 1000);
  assert.ok(LIMITS.instructionRules === 40);
});

console.log('\n通过 ' + pass + '/' + (pass + fail));
process.exit(fail ? 1 : 0);
