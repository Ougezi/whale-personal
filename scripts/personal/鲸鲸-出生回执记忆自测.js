'use strict';
/** B5-02 回执→记忆自测。 */
const assert = require('node:assert');
const { createReceiptTracker } = require('../../packages/memory-core/receipts.js');

let pass = 0, fail = 0;
function check(name, fn) {
  try { fn(); pass++; console.log('  ✓ ' + name); }
  catch (e) { fail++; console.log('  ✗ ' + name + '  ' + (e && e.message)); }
}
function raises(fn) {
  try { fn(); } catch { return; }
  throw new Error('did not raise');
}
function fresh() { return createReceiptTracker({ now: () => 1000 }); }

check('pending 不能声称', () => {
  const t = fresh(); t.register({ id: 'm1', target: 'wxid' });
  assert.strictEqual(t.canClaim('m1', 'sent'), false);
  assert.strictEqual(t.canClaim('m1', 'delivered'), false);
});

check('sent 只能声称已发', () => {
  const t = fresh(); t.register({ id: 'm1', target: 'wxid' }); t.mark('m1', 'sent');
  assert.strictEqual(t.canClaim('m1', 'sent'), true);
  assert.strictEqual(t.canClaim('m1', 'delivered'), false);
});

check('delivered 才能声称送达', () => {
  const t = fresh(); t.register({ id: 'm1', target: 'wxid' }); t.mark('m1', 'sent'); t.mark('m1', 'delivered');
  assert.strictEqual(t.canClaim('m1', 'delivered'), true);
});

check('缺回执阻断', () => {
  const t = fresh();
  assert.strictEqual(t.canClaim('nope', 'delivered'), false);
  assert.throws(() => t.assertClaim('nope', 'delivered'));
});

check('非法跳转拒绝', () => {
  const t = fresh(); t.register({ id: 'm1', target: 'wxid' });
  assert.throws(() => t.mark('m1', 'delivered'));
});

check('failed 写教训不写成功', () => {
  const t = fresh(); t.register({ id: 'm1', target: 'wxid' }); t.mark('m1', 'failed');
  assert.strictEqual(t.canClaim('m1', 'delivered'), false);
  assert.strictEqual(t.memories()[0].kind, 'lesson');
  assert.strictEqual(t.stats().capabilities.say, undefined);
});

check('timeout 写教训', () => {
  const t = fresh(); t.register({ id: 'm1', target: 'wxid' }); t.mark('m1', 'timeout');
  assert.strictEqual(t.memories()[0].reason, 'timeout');
});

check('delivered 写情节', () => {
  const t = fresh(); t.register({ id: 'm1', target: 'wxid' }); t.mark('m1', 'sent'); t.mark('m1', 'delivered');
  assert.strictEqual(t.memories()[0].kind, 'episode');
  assert.strictEqual(t.stats().capabilities.say, 1);
});

check('promise 写承诺', () => {
  const t = fresh(); t.register({ id: 'm1', target: 'wxid', promise: true }); t.mark('m1', 'sent'); t.mark('m1', 'delivered');
  assert.ok(t.memories().some((m) => m.kind === 'promise'));
});

check('delivered 幂等不重复计数', () => {
  const t = fresh(); t.register({ id: 'm1', target: 'wxid' }); t.mark('m1', 'sent'); t.mark('m1', 'delivered'); t.mark('m1', 'delivered');
  assert.strictEqual(t.stats().capabilities.say, 1);
  assert.strictEqual(t.memories().length, 1);
});

check('终态不可改', () => {
  const t = fresh(); t.register({ id: 'm1', target: 'wxid' }); t.mark('m1', 'sent'); t.mark('m1', 'delivered');
  assert.throws(() => t.mark('m1', 'failed'));
});

check('coverage', () => {
  const t = fresh(); t.register({ id: 'm1', target: 'wxid' }); t.register({ id: 'm2', target: 'wxid' });
  t.mark('m1', 'sent');
  assert.strictEqual(t.coverage(2), 0.5);
});

check('重复注册幂等', () => {
  const t = fresh(); t.register({ id: 'm1', target: 'wxid' });
  assert.strictEqual(t.register({ id: 'm1', target: 'wxid' }).duplicate, true);
  assert.strictEqual(t.stats().total, 1);
});

console.log('\n通过 ' + pass + '/' + (pass + fail));
process.exit(fail ? 1 : 0);
