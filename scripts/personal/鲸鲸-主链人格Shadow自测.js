'use strict';
/** I-23 affect/expression/scope shadow。 */
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const features = require('../../src/infra/features.js');
const S = require('../../src/services/personaShadow.js');
let pass = 0, fail = 0;
function check(n, fn) { try { fn(); pass++; console.log('  ✓ ' + n); } catch (e) { fail++; console.log('  ✗ ' + n + '  ' + (e && e.message)); } }
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-i23-'));
S._reset();
check('personaShadow 默认关', () => assert.strictEqual(features.isOn({ features: {} }, 'personaShadow'), false));
check('无 dataDir 不记录', () => assert.strictEqual(S.observe({ chatId: 'c' }), null));
const r = S.observe({ dataDir: dir, chatId: 'wechat:u:x', chatType: 'private', senderId: 'u1', text: '谢谢，辛苦了', reply: 'v1.2.3 [[0]]' , now: 1000 });
check('有 shadow 结果', () => assert.ok(r && r.shadow === true));
check('scope 已生成', () => assert.ok(r.scope && r.scope.includes('private')));
check('affect 有 label', () => assert.ok(r.affect && r.affect.label));
check('expression 有 literals', () => assert.strictEqual(typeof r.expression.literals, 'number'));
check('写 shadow 文件', () => assert.ok(fs.existsSync(path.join(dir, 'persona-shadow.jsonl'))));
check('不改正式文件', () => assert.ok(!fs.existsSync(path.join(dir, 'messages.jsonl'))));
check('feature 可开', () => assert.strictEqual(features.isOn({ features: { personaShadow: true } }, 'personaShadow'), true));
console.log('\n通过 ' + pass + '/' + (pass + fail));
fs.rmSync(dir, { recursive: true, force: true });
process.exit(fail ? 1 : 0);
