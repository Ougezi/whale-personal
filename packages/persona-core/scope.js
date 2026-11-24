'use strict';
/**
 * 出生技能 · 身份/隐私/群聊（B2-03）。
 *
 * Account → Persona → Scope。
 * 规则（fail-closed）：
 *  - 不同 account 不互相召回；
 *  - 不同 persona 不互相召回；
 *  - private 只在同 account/persona/contact 的私聊可召回；
 *  - group 只在同 account/persona/group 的群聊可召回；
 *  - group 不能召回 private；private 不能召回 group；
 *  - 未知 kind/chatType 一律拒绝。
 *
 * 本步只做核心判定；不接现有 receiver_mixin/store。
 */
const KINDS = new Set(['private', 'group', 'world']);

function str(v, max = 120) { return String(v == null ? '' : v).trim().slice(0, max); }

function makeScope({ platform = 'wechat', accountId, personaId = 'default', kind = 'private', contactId = '', groupId = '', worldId = '' } = {}) {
  const account = str(accountId);
  const persona = str(personaId) || 'default';
  const k = str(kind);
  if (!account) throw new Error('accountId required');
  if (!KINDS.has(k)) throw new Error('invalid scope kind: ' + k);
  const base = { platform: str(platform), accountId: account, personaId: persona, kind: k };
  if (k === 'private') base.contactId = str(contactId);
  if (k === 'group') base.groupId = str(groupId);
  if (k === 'world') base.worldId = str(worldId);
  base.key = [base.platform, base.accountId, base.personaId, base.kind, base.contactId || base.groupId || base.worldId || ''].join(':');
  return base;
}

function sameIdentity(a, b) {
  return Boolean(a && b) && a.platform === b.platform && a.accountId === b.accountId && a.personaId === b.personaId;
}

function canRecall(viewer, memory) {
  if (!viewer || !memory) return false;
  if (!KINDS.has(viewer.kind) || !KINDS.has(memory.kind)) return false;
  if (!sameIdentity(viewer, memory)) return false;
  if (memory.kind === 'private') {
    return viewer.kind === 'private' && Boolean(viewer.contactId) && viewer.contactId === memory.contactId;
  }
  if (memory.kind === 'group') {
    return viewer.kind === 'group' && Boolean(viewer.groupId) && viewer.groupId === memory.groupId;
  }
  if (memory.kind === 'world') {
    return viewer.kind === 'world' && Boolean(viewer.worldId) && viewer.worldId === memory.worldId;
  }
  return false;
}

function filterMemories(viewer, memories) {
  return (Array.isArray(memories) ? memories : []).filter((m) => canRecall(viewer, m));
}

/** 主人判定：群聊/私聊都允许，但必须是主人本人；未知 chatType 拒绝。 */
function isMaster({ senderId, masterId, chatType = 'private' } = {}) {
  const s = str(senderId), m = str(masterId);
  if (!s || !m || s !== m) return false;
  if (chatType !== 'private' && chatType !== 'group') return false;
  return true;
}

function scopeKey(scope) { return makeScope(scope).key; }

module.exports = { KINDS, makeScope, canRecall, filterMemories, isMaster, scopeKey, sameIdentity };
