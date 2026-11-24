'use strict';
/** I-28：expressionCore 技术 literal 保护；默认关，按 chat 白名单。 */
const { mask, unmask } = require('../../packages/persona-core/expression.js');

function allowed(chatId, chats) {
  if (chats === undefined) return true;
  return Array.isArray(chats) && chats.map(String).includes(String(chatId));
}

function protect({ chatId, text = '', chats = undefined } = {}) {
  if (!allowed(chatId, chats)) return null;
  const r = mask(String(text || ''));
  return r.literals.length ? r : null;
}

function restore(text, guard) {
  if (!guard) return String(text || '');
  return unmask(String(text || ''), guard.literals);
}

module.exports = { protect, restore };
