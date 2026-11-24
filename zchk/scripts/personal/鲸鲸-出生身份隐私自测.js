'use strict';
/** B2-03 身份/隐私/群聊自测。 */
const assert = require('node:assert');
const { makeScope, canRecall, filterMemories, isMaster, scopeKey } = require('../../packages/persona-core/scope.js');

let pass = 0, fail = 0;
function check(name, fn) {
  try { fn(); pass++; console.log('  ✓ ' + name); }
  catch (e) { fail++; console.log('  ✗ ' + name + '  ' + (e && e.message)); }
}

const masterPriv = makeScope({ accountId: 'wxid_master', kind: 'private', contactId: 'wxid_master' });
const otherPriv = makeScope({ accountId: 'wxid_other', kind: 'private', contactId: 'wxid_master' });
const friendPriv = makeScope({ accountId: 'wxid_master', kind: 'private', contactId: 'wxid_friend' });
const group = makeScope({ accountId: 'wxid_master', kind: 'group', groupId: '123@chatroom' });
const otherGroup = makeScope({ accountId: 'wxid_other', kind: 'group', groupId: '123@chatroom' });
const otherPersona = makeScope({ accountId: 'wxid_master', personaId: 'other', kind: 'private', contactId: 'wxid_master' });

check('scope key 稳定', () => {
  assert.strictEqual(scopeKey(masterPriv), scopeKey({ ...masterPriv }));
});

check('同私聊可召回', () => {
  assert.strictEqual(canRecall(masterPriv, masterPriv), true);
});

check('不同账号隔离', () => {
  assert.strictEqual(canRecall(otherPriv, masterPriv), false);
  assert.strictEqual(canRecall(otherGroup, group), false);
});

check('不同联系人隔离', () => {
  assert.strictEqual(canRecall(friendPriv, masterPriv), false);
});

check('不同 persona 隔离', () => {
  assert.strictEqual(canRecall(otherPersona, masterPriv), false);
});

check('群不能召回私聊', () => {
  assert.strictEqual(canRecall(group, masterPriv), false);
});

check('私聊不能召回群', () => {
  assert.strictEqual(canRecall(masterPriv, group), false);
});

check('同群可召回', () => {
  assert.strictEqual(canRecall(group, group), true);
});

check('不同群隔离', () => {
  const g2 = makeScope({ accountId: 'wxid_master', kind: 'group', groupId: '999@chatroom' });
  assert.strictEqual(canRecall(g2, group), false);
});

check('未知类型拒绝', () => {
  assert.throws(() => makeScope({ accountId: 'a', kind: 'weird' }));
  assert.strictEqual(canRecall({ ...masterPriv, kind: 'weird' }, masterPriv), false);
});

check('主人判定 私聊/群聊', () => {
  assert.strictEqual(isMaster({ senderId: 'wxid_master', masterId: 'wxid_master', chatType: 'private' }), true);
  assert.strictEqual(isMaster({ senderId: 'wxid_master', masterId: 'wxid_master', chatType: 'group' }), true);
  assert.strictEqual(isMaster({ senderId: 'wxid_other', masterId: 'wxid_master', chatType: 'group' }), false);
  assert.strictEqual(isMaster({ senderId: 'wxid_master', masterId: 'wxid_master', chatType: 'weird' }), false);
});

check('批量过滤', () => {
  const list = [masterPriv, group, friendPriv, otherPriv];
  assert.deepStrictEqual(filterMemories(masterPriv, list).map((x) => x.kind), ['private']);
  assert.strictEqual(filterMemories(group, list).length, 1);
});

console.log('\n通过 ' + pass + '/' + (pass + fail));
process.exit(fail ? 1 : 0);
