'use strict';
/** I-28 expressionCore literal 保护。 */
const assert = require('node:assert');
const features = require('../../src/infra/features.js');
const E = require('../../src/services/expressionCore.js');
let pass = 0, fail = 0;
function check(n, fn) { try { fn(); pass++; console.log('  ✓ ' + n); } catch (e) { fail++; console.log('  ✗ ' + n + '  ' + (e && e.message)); } }
check('expressionCore 默认关', () => assert.strictEqual(features.isOn({ features: {} }, 'expressionCore'), false));
const g = E.protect({ text: '版本 v1.2.3，路径 D:\\a\\b.txt', chats: undefined });
check('识别 literal', () => assert.ok(g && g.literals.length >= 2));
check('mask 后不含原文', () => assert.ok(!g.masked.includes('v1.2.3')));
check('restore 还原', () => assert.strictEqual(E.restore(g.masked, g), '版本 v1.2.3，路径 D:\\a\\b.txt'));
check('空名单不保护', () => assert.strictEqual(E.protect({ text: 'v1.2.3', chats: [] }), null));
check('名单内保护', () => assert.ok(E.protect({ chatId: 'c1', text: 'v1.2.3', chats: ['c1'] })));
check('名单外不保护', () => assert.strictEqual(E.protect({ text: 'v1.2.3', chats: ['other'] }), null));
check('feature 可开', () => assert.strictEqual(features.isOn({ features: { expressionCore: true } }, 'expressionCore'), true));
console.log('\n通过 ' + pass + '/' + (pass + fail));
process.exit(fail ? 1 : 0);
