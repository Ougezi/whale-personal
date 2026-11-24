'use strict';
/** I-30 scope shadow fail-closed。 */
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const features = require('../../src/infra/features.js');
const S = require('../../src/services/scopeShadow.js');
let pass = 0, fail = 0;
function check(n, fn) { try { fn(); pass++; console.log('  ✓ ' + n); } catch (e) { fail++; console.log('  ✗ ' + n + '  ' + (e && e.message)); } }
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-i30-'));
check('scopeShadow 默认关', () => assert.strictEqual(features.isOn({ features: {} }, 'scopeShadow'), false));
check('空名单不记录', () => assert.strictEqual(S.observe({ dataDir: dir, chatId: 'c', chats: [] }), null));
const p = S.observe({ dataDir: dir, chatId: 'wechat:u:u1', chatType: 'private', senderId: 'u1', chats: ['wechat:u:u1'] });
check('private self recall', () => assert.strictEqual(p.selfRecall, true));
check('private cross 拒绝', () => assert.strictEqual(p.crossRecall, false));
check('failClosed true', () => assert.strictEqual(p.failClosed, true));
const g = S.observe({ dataDir: dir, chatId: 'wechat:g:g1', chatType: 'group', senderId: 'u1', chats: ['wechat:g:g1'] });
check('group cross 拒绝', () => assert.strictEqual(g.crossRecall, false));
check('写 scope-shadow', () => assert.ok(fs.existsSync(path.join(dir, 'scope-shadow.jsonl'))));
check('名单外不记录', () => assert.strictEqual(S.observe({ dataDir: dir, chatId: 'other', chats: ['wechat:u:u1'] }), null));
console.log('\n通过 ' + pass + '/' + (pass + fail));
fs.rmSync(dir, { recursive: true, force: true });
process.exit(fail ? 1 : 0);
