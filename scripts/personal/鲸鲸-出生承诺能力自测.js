'use strict';
/** B5-03 承诺/能力自测。 */
const assert = require('node:assert');
const { createCommitmentLedger } = require('../../packages/memory-core/commitment.js');

let pass = 0, fail = 0;
function check(name, fn) {
  try { fn(); pass++; console.log('  ✓ ' + name); }
  catch (e) { fail++; console.log('  ✗ ' + name + '  ' + (e && e.message)); }
}
function ledger() { return createCommitmentLedger({ now: () => 1000 }); }

check('open 默认', () => {
  const l = ledger(); l.add({ id: 'c1', text: '查日志', dueAt: 5000, skill: 'ops' });
  assert.strictEqual(l.snapshot('c1').state, 'open');
});

check('证据 -> kept', () => {
  const l = ledger(); l.add({ id: 'c1', text: '查日志', dueAt: 5000, skill: 'ops' });
  l.addEvidence('c1', 'log:1');
  l.resolve('c1', 2000);
  assert.strictEqual(l.snapshot('c1').state, 'kept');
});

check('到期无证据 -> failed', () => {
  const l = ledger(); l.add({ id: 'c1', text: '查日志', dueAt: 5000 });
  l.resolve('c1', 6000);
  assert.strictEqual(l.snapshot('c1').state, 'failed');
});

check('到期有证据 -> kept', () => {
  const l = ledger(); l.add({ id: 'c1', text: '查日志', dueAt: 5000 });
  l.addEvidence('c1', 'log:1'); l.resolve('c1', 6000);
  assert.strictEqual(l.snapshot('c1').state, 'kept');
});

check('未到期无证据仍 open', () => {
  const l = ledger(); l.add({ id: 'c1', text: '查日志', dueAt: 5000 });
  l.resolve('c1', 2000);
  assert.strictEqual(l.snapshot('c1').state, 'open');
});

check('空证据拒绝', () => {
  const l = ledger(); l.add({ id: 'c1', text: '查日志' });
  assert.throws(() => l.addEvidence('c1', '  '));
});

check('终态不可补证据', () => {
  const l = ledger(); l.add({ id: 'c1', text: '查日志', dueAt: 5000 });
  l.resolve('c1', 6000);
  assert.throws(() => l.addEvidence('c1', 'late'));
});

check('能力 2 次不虚标', () => {
  const l = ledger();
  for (let i = 0; i < 2; i++) { l.add({ id: 'c' + i, text: 'ops', skill: 'ops' }); l.addEvidence('c' + i, 'e' + i); l.resolve('c' + i); }
  assert.strictEqual(l.competence().length, 0);
});

check('能力 3 次才写', () => {
  const l = ledger();
  for (let i = 0; i < 3; i++) { l.add({ id: 'c' + i, text: 'ops', skill: 'ops' }); l.addEvidence('c' + i, 'e' + i); l.resolve('c' + i); }
  assert.strictEqual(l.competence()[0].skill, 'ops');
  assert.strictEqual(l.competence()[0].kept, 3);
});

check('failed 不计能力', () => {
  const l = ledger();
  l.add({ id: 'c1', text: 'ops', skill: 'ops', dueAt: 5000 }); l.resolve('c1', 6000);
  assert.strictEqual(l.competence().length, 0);
});

check('重复证据不重复计数', () => {
  const l = ledger();
  l.add({ id: 'c1', text: 'ops', skill: 'ops' });
  l.addEvidence('c1', 'e'); l.addEvidence('c1', 'e'); l.resolve('c1');
  assert.strictEqual(l.snapshot('c1').evidence.length, 1);
});

check('到期提醒', () => {
  const l = ledger(); l.add({ id: 'c1', text: 'ops', dueAt: 5000 });
  assert.strictEqual(l.due(4000, 2000).length, 1);
});

check('重复 add 幂等', () => {
  const l = ledger(); l.add({ id: 'c1', text: 'ops' });
  assert.strictEqual(l.add({ id: 'c1', text: 'ops2' }).duplicate, true);
});

console.log('\n通过 ' + pass + '/' + (pass + fail));
process.exit(fail ? 1 : 0);
