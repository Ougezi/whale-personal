'use strict';
/** I-21 registry 只读目录/校验。 */
const assert = require('node:assert');
const R = require('../../src/services/actionRegistry.js');
let pass = 0, fail = 0;
function check(n, fn) { try { fn(); pass++; console.log('  ✓ ' + n); } catch (e) { fail++; console.log('  ✗ ' + n + '  ' + (e && e.message)); } }
check('8 个 ActionSpec', () => assert.strictEqual(R.catalog().length, 8));
check('edit 是 R2', () => assert.strictEqual(R.get('edit').risk, 'R2'));
check('未知动作返回 null', () => assert.strictEqual(R.get('nope'), null));
check('edit 缺参数拒绝', () => assert.strictEqual(R.validate('edit', {}).ok, false));
check('read 合法通过', () => assert.strictEqual(R.validate('read', { path: 'x' }).ok, true));
check('R3 两次审批', () => assert.strictEqual(R.approvalsFor('R3'), 2));
check('未知动作拒绝', () => assert.strictEqual(R.validate('weird', {}).ok, false));
check('目录带审批数', () => assert.strictEqual(R.catalog().find((x) => x.id === 'edit').approvals, 1));
console.log('\n通过 ' + pass + '/' + (pass + fail));
process.exit(fail ? 1 : 0);
