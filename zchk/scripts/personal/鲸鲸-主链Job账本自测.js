'use strict';
/** I-16 action-core/job.js 接入 kernel。 */
const assert = require('node:assert');
const { createActionJobs } = require('../../src/services/actionJobs.js');

let pass = 0, fail = 0;
function check(name, fn) {
  try { fn(); pass++; console.log('  ✓ ' + name); }
  catch (e) { fail++; console.log('  ✗ ' + name + '  ' + (e && e.message)); }
}
const J = createActionJobs();

check('R0 create/start', () => {
  assert.strictEqual(J.apply({ op: 'create', id: 'j1', risk: 'R0' }).job.state, 'queued');
  assert.strictEqual(J.apply({ op: 'start', id: 'j1' }).job.state, 'running');
});
check('R0 succeed', () => assert.strictEqual(J.apply({ op: 'finish', id: 'j1', ok: true }).job.state, 'succeeded'));
check('R2 未批不能 start', () => {
  J.apply({ op: 'create', id: 'j2', risk: 'R2' });
  assert.strictEqual(J.apply({ op: 'start', id: 'j2' }).ok, false);
});
check('R2 一次批准', () => {
  assert.strictEqual(J.apply({ op: 'approve', id: 'j2', approver: 'owner' }).job.state, 'queued');
  assert.strictEqual(J.apply({ op: 'start', id: 'j2' }).job.state, 'running');
});
check('R3 两次批准', () => {
  J.apply({ op: 'create', id: 'j3', risk: 'R3' });
  assert.strictEqual(J.apply({ op: 'approve', id: 'j3', approver: 'a' }).job.state, 'awaiting_approval');
  assert.strictEqual(J.apply({ op: 'approve', id: 'j3', approver: 'b' }).job.state, 'queued');
});
check('失败终态', () => {
  J.apply({ op: 'create', id: 'j4', risk: 'R0' }); J.apply({ op: 'start', id: 'j4' });
  assert.strictEqual(J.apply({ op: 'finish', id: 'j4', ok: false, reason: 'no' }).job.state, 'failed');
});
check('未知 job 拒绝', () => assert.strictEqual(J.apply({ op: 'start', id: 'nope' }).ok, false));
check('重复 create 幂等', () => assert.strictEqual(J.apply({ op: 'create', id: 'j1', risk: 'R0' }).duplicate, true));
check('统计可读', () => assert.ok(J.stats().total >= 4));

console.log('\n通过 ' + pass + '/' + (pass + fail));
process.exit(fail ? 1 : 0);
