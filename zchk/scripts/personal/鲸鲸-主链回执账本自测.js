'use strict';
/** I-17 receipts.js 账本接线。 */
const assert = require('node:assert');
const { createReceiptLedger } = require('../../src/services/receiptLedger.js');

let pass = 0, fail = 0;
function check(name, fn) {
  try { fn(); pass++; console.log('  ✓ ' + name); }
  catch (e) { fail++; console.log('  ✗ ' + name + '  ' + (e && e.message)); }
}
const L = createReceiptLedger();

check('成功回执 delivered', () => {
  const r = L.ingest({ id: 'r1', target: 'wxid_a', text: 'hi', ok: true, at: 1000 });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.receipt.state, 'delivered');
});
check('失败回执 failed', () => {
  const r = L.ingest({ id: 'r2', target: 'wxid_a', text: 'hi', ok: false, reason: 'no_send_button', at: 1001 });
  assert.strictEqual(r.receipt.state, 'failed');
});
check('重复 id 幂等', () => {
  const r = L.ingest({ id: 'r1', target: 'wxid_a', text: 'hi', ok: true, at: 1002 });
  assert.strictEqual(r.duplicate, true);
});
check('缺 target 拒绝', () => {
  const r = L.ingest({ id: 'r3', ok: true });
  assert.strictEqual(r.ok, false);
});
check('统计为 2', () => {
  const s = L.stats();
  assert.strictEqual(s.total, 2);
  assert.strictEqual(s.byState.delivered, 1);
  assert.strictEqual(s.byState.failed, 1);
});
check('最近 1 条', () => assert.strictEqual(L.last(1).length, 1));
check('不声称未送达为 delivered', () => {
  const r = L.ingest({ id: 'r4', target: 'wxid_b', text: 'x', ok: false, at: 1003 });
  assert.strictEqual(r.receipt.state, 'failed');
});

console.log('\n通过 ' + pass + '/' + (pass + fail));
process.exit(fail ? 1 : 0);
