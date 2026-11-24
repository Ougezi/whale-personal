'use strict';
/** B3-03 Job/审批/进程树自测。 */
const assert = require('node:assert');
const { createJob, createProcessTracker } = require('../../packages/action-core/job.js');

let pass = 0, fail = 0;
function check(name, fn) {
  try { fn(); pass++; console.log('  ✓ ' + name); }
  catch (e) { fail++; console.log('  ✗ ' + name + '  ' + (e && e.message)); }
}

check('R2 未确认不能启动', () => {
  const j = createJob({ id: 'j1', risk: 'R2', action: 'edit', now: 1000 });
  assert.strictEqual(j.snapshot().state, 'awaiting_approval');
  assert.throws(() => j.start(2000));
});

check('R2 一次确认可启动', () => {
  const j = createJob({ id: 'j2', risk: 'R2', now: 1000 });
  j.approve('owner', 1500);
  assert.strictEqual(j.snapshot().state, 'queued');
  j.start(2000);
  assert.strictEqual(j.snapshot().state, 'running');
});

check('R3 一次不够/两次够', () => {
  const j = createJob({ id: 'j3', risk: 'R3', now: 1000 });
  j.approve('owner', 1500);
  assert.strictEqual(j.snapshot().state, 'awaiting_approval');
  j.approve('owner2', 1600);
  assert.strictEqual(j.snapshot().state, 'queued');
});

check('重复批准不重复计数', () => {
  const j = createJob({ id: 'j4', risk: 'R3', now: 1000 });
  j.approve('owner', 1500);
  j.approve('owner', 1600);
  assert.strictEqual(j.snapshot().approvals.length, 1);
  assert.strictEqual(j.snapshot().state, 'awaiting_approval');
});

check('拒绝不能启动', () => {
  const j = createJob({ id: 'j5', risk: 'R2', now: 1000 });
  j.reject('owner', 1500);
  assert.strictEqual(j.snapshot().state, 'rejected');
  assert.throws(() => j.start(2000));
});

check('R0 直接 queued', () => {
  const j = createJob({ id: 'j6', risk: 'R0', now: 1000 });
  assert.strictEqual(j.snapshot().state, 'queued');
  j.start(2000);
  assert.strictEqual(j.snapshot().state, 'running');
});

check('取消 ≤2s 停止', () => {
  const j = createJob({ id: 'j7', risk: 'R0', now: 1000 });
  j.start(2000);
  j.cancel(3000);
  assert.strictEqual(j.snapshot().state, 'cancelling');
  assert.strictEqual(j.snapshot().cancelDeadline, 5000);
  j.tick(5000);
  assert.strictEqual(j.snapshot().state, 'cancelled');
  assert.strictEqual(j.snapshot().stopMs, 2000);
});

check('取消幂等', () => {
  const j = createJob({ id: 'j8', risk: 'R0', now: 1000 });
  j.start(2000);
  j.cancel(3000);
  j.cancel(3100);
  j.tick(5000);
  const a = j.snapshot();
  j.cancel(6000);
  assert.deepStrictEqual(j.snapshot(), a);
});

check('超时 timed_out', () => {
  const j = createJob({ id: 'j9', risk: 'R0', timeoutMs: 1000, now: 1000 });
  j.start(2000);
  j.tick(4000);
  assert.strictEqual(j.snapshot().state, 'timed_out');
});

check('终态不能执行', () => {
  const j = createJob({ id: 'j10', risk: 'R0', now: 1000 });
  j.start(2000);
  j.succeed('ok', 3000);
  assert.strictEqual(j.snapshot().state, 'succeeded');
  assert.throws(() => j.start(4000));
  assert.throws(() => j.succeed('again', 5000));
});

check('进程树 children-first', () => {
  const alive = new Set([1, 2, 3, 4]);
  const order = [];
  const t = createProcessTracker({ kill: (pid) => { order.push(pid); alive.delete(pid); }, isAlive: (pid) => alive.has(pid) });
  t.add(2, 1); t.add(3, 2); t.add(4, 1);
  const r = t.killTree(1);
  assert.deepStrictEqual(order.slice(0, 3).sort(), [2, 3, 4]);
  assert.strictEqual(order[order.length - 1], 1);
  assert.deepStrictEqual(r.orphans, []);
});

check('killTree 幂等', () => {
  const alive = new Set([1, 2]);
  const t = createProcessTracker({ kill: (pid) => alive.delete(pid) });
  t.add(2, 1);
  t.killTree(1);
  const r = t.killTree(1);
  assert.deepStrictEqual(r.killed, []);
  assert.strictEqual(alive.size, 0);
});

check('无孤儿', () => {
  const alive = new Set([1, 2, 3]);
  const t = createProcessTracker({ kill: (pid) => alive.delete(pid) });
  t.add(2, 1); t.add(3, 2);
  t.killTree(1);
  assert.deepStrictEqual(t.orphans(), []);
});

console.log('\n通过 ' + pass + '/' + (pass + fail));
process.exit(fail ? 1 : 0);
