'use strict';
/** I-25/26：affectCore 正式候选；默认关，按 chat 白名单生效。 */
const { createAffect } = require('../../packages/persona-core/affect.js');
const states = new Map();
const last = new Map();

function stateFor(chatId) {
  if (!states.has(chatId)) states.set(chatId, createAffect({ valence: 0.1, arousal: 0.35 }));
  return states.get(chatId);
}

function allowed(chatId, chats) {
  if (chats === undefined) return true; // 直接调用/测试：不传名单
  return Array.isArray(chats) && chats.map(String).includes(String(chatId));
}

function tick({ chatId, text = '', now = Date.now(), chats = undefined } = {}) {
  const id = String(chatId || '').trim();
  if (!id) return { line: '', snapshot: null, skipped: 'no-chat' };
  if (!allowed(id, chats)) return { line: '', snapshot: null, skipped: 'not-allowed' };
  const a = stateFor(id);
  const t = String(text || '');
  const dv = /谢谢|喜欢|可爱|厉害|棒|辛苦|爱你/.test(t) ? 0.04 : /笨|烦|滚|讨厌|气死|无语/.test(t) ? -0.04 : 0;
  const da = /快|急|马上|赶紧|怎么还没/.test(t) ? 0.03 : 0;
  const s = a.update({ deltaV: dv, deltaA: da, at: now });
  const out = { line: `【Core 心情】${s.label}（愉悦 ${s.valence} / 激活 ${s.arousal}）`, snapshot: s, at: now };
  last.set(id, out);
  return out;
}
function status(chatId) { return last.get(String(chatId || '')) || null; }
function _reset() { states.clear(); last.clear(); }
module.exports = { tick, status, _reset };
