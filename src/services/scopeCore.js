'use strict';
/** I-32：scopeCore 事件候选过滤；默认关，失败 fail-open。 */
const { makeScope, canRecall } = require('../../packages/persona-core/scope.js');

function allowed(chatId, chats) {
  if (chats === undefined) return true;
  return Array.isArray(chats) && chats.map(String).includes(String(chatId));
}

function viewerFor({ chatId, chatType = 'private', senderId = '' }) {
  const kind = chatType === 'group' ? 'group' : 'private';
  return makeScope({ platform: 'wechat', accountId: 'default', personaId: 'default', kind,
    contactId: kind === 'private' ? (senderId || chatId) : '',
    groupId: kind === 'group' ? chatId : '' });
}

function filter({ events, chatId, chatType = 'private', senderId = '', chats = undefined } = {}) {
  if (!allowed(chatId, chats)) return events || [];
  try {
    const viewer = viewerFor({ chatId, chatType, senderId });
    return (events || []).filter((ev) => {
      if (!ev || ev.scope === undefined) return true;
      if (ev.scope && typeof ev.scope === 'object' && ev.scope.kind) return canRecall(viewer, ev.scope);
      return true; // 未知 scope 交给旧链，别误拦
    });
  } catch { return events || []; }
}

module.exports = { filter, viewerFor };
