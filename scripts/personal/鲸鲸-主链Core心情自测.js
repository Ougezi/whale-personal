'use strict';
/** I-25 affectCore 默认关候选。 */
const assert = require('node:assert');
const features = require('../../src/infra/features.js');
const A = require('../../src/services/affectCore.js');
let pass = 0, fail = 0;
function check(n, fn) { try { fn(); pass++; console.log('  ✓ ' + n); } catch (e) { fail++; console.log('  ✗ ' + n + '  ' + (e && e.message)); } }
A._reset();
check('affectCore 默认关', () => assert.strictEqual(features.isOn({ features: {} }, 'affectCore'), false));
check('空 chat 不产出', () => assert.strictEqual(A.tick({ chatId: '' }).line, ''));
const r = A.tick({ chatId: 'c1', text: '谢谢，辛苦了', now: 1000 });
check('有 Core 行', () => assert.ok(r.line.includes('Core')));
check('label 存在', () => assert.ok(r.snapshot.label));
check('愉悦上升', () => assert.ok(r.snapshot.valence > 0.1));
check('chat 隔离', () => assert.notStrictEqual(A.tick({ chatId: 'c2', now: 2000 }).snapshot.valence, r.snapshot.valence));
check('可重复', () => assert.ok(A.tick({ chatId: 'c1', now: 3000 }).line));
check('空名单不生效', () => assert.strictEqual(A.tick({ chatId: 'c3', text: '谢谢', chats: [] }).line, ''))
check('名单内生效', () => assert.ok(A.tick({ chatId: 'c4', text: '谢谢', chats: ['c4'] }).line.includes('Core')))
check('名单外不生效', () => assert.strictEqual(A.tick({ chatId: 'c5', text: '谢谢', chats: ['c4'] }).line, ''))

check('status 可读', () => assert.ok(A.status('c1') && A.status('c1').line.includes('Core')))
check('status 无记录为 null', () => assert.strictEqual(A.status('nope'), null))

check('feature 可开', () => assert.strictEqual(features.isOn({ features: { affectCore: true } }, 'affectCore'), true));
console.log('\n通过 ' + pass + '/' + (pass + fail));
process.exit(fail ? 1 : 0);
