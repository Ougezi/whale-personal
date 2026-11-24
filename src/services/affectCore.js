'use strict';
/** I-25：affectCore 正式候选；默认关，开启后加一条 Core 心情行。 */
const { createAffect } = require('../../packages/persona-core/affect.js');
const states = new Map();

function stateFor(chatId) {
  if (!states.has(chatId)) states.set(chatId, createAffect({ valence: 0.1, arousal: 0.35 }));
  return states.get(chatId);
}

function tick({ chatId, text = '', now = Date.now() } = {}) {
  const id = String(chatId || '').trim();
  if (!id) return { line: '', snapshot: null };
  const a = stateFor(id);
  const t = String(text || '');
  const dv = /谢谢|喜欢|可爱|厉害|棒|辛苦|爱你/.test(t) ? 0.04 : /笨|烦|滚|讨厌|气死|无语/.test(t) ? -0.04 : 0;
  const da = /快|急|马上|赶紧|怎么还没/.test(t) ? 0.03 : 0;
  const s = a.update({ deltaV: dv, deltaA: da, at: now });
  return { line: `【Core 心情】${s.label}（愉悦 ${s.valence} / 激活 ${s.arousal}）`, snapshot: s };
}
function _reset() { states.clear(); }
module.exports = { tick, _reset };
