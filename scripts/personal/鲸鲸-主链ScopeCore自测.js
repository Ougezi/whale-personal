'use strict';
/** I-32 scopeCore 召回过滤。 */
const assert = require('node:assert');
const features = require('../../src/infra/features.js');
const S = require('../../src/services/scopeCore.js');
const { makeScope } = require('../../packages/persona-core/scope.js');
let pass = 0, fail = 0;
function check(n, fn) { try { fn(); pass++; console.log('  ✓ ' + n); } catch (e) { fail++; console.log('  ✗ ' + n + '  ' + (e && e.message)); } }
const me = makeScope({ accountId: 'default', kind: 'private', contactId: 'u1' });
const other = makeScope({ accountId: 'default', kind: 'private', contactId: 'u2' });
const group = makeScope({ accountId: 'default', kind: 'group', groupId: 'g1' });
const events = [{ id: 'a' }, { id: 'b', scope: me }, { id: 'c', scope: other }, { id: 'd', scope: group }];
check('scopeCore 默认关', () => assert.strictEqual(features.isOn({ features: {} }, 'scopeCore'), false));
check('空名单不启用', () => assert.strictEqual(S.filter({ events, chatId: 'x', chats: [] }).length, 4));
check('名单内过滤', () => {
  const r = S.filter({ events, chatId: 'x', chatType: 'private', senderId: 'u1', chats: ['x'] });
  assert.deepStrictEqual(r.map((e) => e.id), ['a', 'b']);
});
check('群聊 viewer', () => assert.ok(S.viewerFor({ chatId: 'g1', chatType: 'group' }).key.includes('group')));
check('私聊 viewer', () => assert.ok(S.viewerFor({ chatId: 'u1', chatType: 'private', senderId: 'u1' }).key.includes('private')));
check('名单外不过滤', () => assert.strictEqual(S.filter({ events, chatId: 'y', chats: ['x'] }).length, 4));
check('无 scope 保留', () => assert.strictEqual(S.filter({ events: [{ id: 'z' }], chatId: 'x', chats: ['x'] }).length, 1));
check('异常 fail-open', () => assert.strictEqual(S.filter({ events: null, chatId: 'x', chats: ['x'] }).length, 0));
console.log('\n通过 ' + pass + '/' + (pass + fail));
process.exit(fail ? 1 : 0);
