'use strict';
/** B3-01 动作注册表自测。 */
const assert = require('node:assert');
const { SPECS, listActions, getAction, validateAction, approvalsFor } = require('../../packages/action-core/registry.js');

let pass = 0, fail = 0;
function check(name, fn) {
  try { fn(); pass++; console.log('  ✓ ' + name); }
  catch (e) { fail++; console.log('  ✗ ' + name + '  ' + (e && e.message)); }
}

check('8 个动作', () => {
  assert.strictEqual(SPECS.length, 8);
  assert.deepStrictEqual(listActions().map((a) => a.id).sort(), ['create_file', 'delete', 'edit', 'inspect', 'read', 'restart', 'run_test', 'send_message']);
});

check('未知动作拒绝', () => {
  assert.strictEqual(getAction('shell'), null);
  const r = validateAction('shell', {});
  assert.strictEqual(r.ok, false);
  assert.deepStrictEqual(r.errors, ['unknown-action']);
});

check('风险映射 R0/R2/R3', () => {
  assert.strictEqual(getAction('inspect').risk, 'R0');
  assert.strictEqual(getAction('run_test').risk, 'R2');
  assert.strictEqual(getAction('delete').risk, 'R3');
});

check('审批次数', () => {
  assert.strictEqual(approvalsFor('R0'), 0);
  assert.strictEqual(approvalsFor('R2'), 1);
  assert.strictEqual(approvalsFor('R3'), 2);
});

check('R2/R3 必须审批', () => {
  for (const id of ['run_test', 'edit', 'create_file', 'delete', 'restart', 'send_message']) {
    assert.strictEqual(getAction(id).requiresApproval, true, id);
  }
  assert.strictEqual(getAction('inspect').requiresApproval, false);
});

check('inspect 参数', () => {
  assert.strictEqual(validateAction('inspect', { goal: '查启动失败' }).ok, true);
  assert.deepStrictEqual(validateAction('inspect', {}).errors, ['missing:goal']);
});

check('edit 参数', () => {
  const ok = validateAction('edit', { path: 'D:\\dsh\\a.md', content: 'hi' });
  assert.strictEqual(ok.ok, true);
  assert.strictEqual(validateAction('edit', { path: 'x' }).errors.includes('missing:content'), true);
});

check('未知参数拒绝', () => {
  const r = validateAction('inspect', { goal: 'x', backdoor: true });
  assert.strictEqual(r.ok, false);
  assert.ok(r.errors.includes('unknown-arg:backdoor'));
});

check('restart 枚举', () => {
  assert.strictEqual(validateAction('restart', { target: 'bridge' }).ok, true);
  assert.ok(validateAction('restart', { target: 'db' }).errors.includes('enum:target'));
});

check('send_message 参数', () => {
  assert.strictEqual(validateAction('send_message', { chat: 'wxid', text: 'hi' }).ok, true);
  assert.ok(validateAction('send_message', { chat: 'wxid' }).errors.includes('missing:text'));
});

check('执行器映射', () => {
  assert.strictEqual(getAction('inspect').executor, 'brain');
  assert.strictEqual(getAction('read').executor, 'bridge');
  assert.strictEqual(getAction('restart').executor, 'launcher');
});

check('动作唯一', () => {
  const ids = listActions().map((a) => a.id);
  assert.strictEqual(new Set(ids).size, ids.length);
});

console.log('\n通过 ' + pass + '/' + (pass + fail));
process.exit(fail ? 1 : 0);
