'use strict';
/** I-23：affect/expression/scope shadow 观察；不改正式回复。 */
const fs = require('node:fs');
const path = require('node:path');
const { createAffect } = require('../../packages/persona-core/affect.js');
const { mask, markers } = require('../../packages/persona-core/expression.js');
const { makeScope } = require('../../packages/persona-core/scope.js');

const affects = new Map();

function affectFor(chatId) {
  if (!affects.has(chatId)) affects.set(chatId, createAffect({ valence: 0.1, arousal: 0.35 }));
  return affects.get(chatId);
}

function observe({ dataDir, chatId, chatType = 'private', senderId = '', text = '', reply = '', now = Date.now() } = {}) {
  const dir = String(dataDir || '').trim();
  const id = String(chatId || '').trim();
  if (!dir || !id) return null;
  const a = affectFor(id);
  const t = String(text || '');
  const dv = /谢谢|喜欢|可爱|厉害|棒|辛苦/.test(t) ? 0.08 : /笨|烦|滚|讨厌|气死/.test(t) ? -0.08 : 0;
  const da = /快|急|马上|赶紧|怎么还没/.test(t) ? 0.06 : 0;
  const affect = a.update({ deltaV: dv, deltaA: da, at: now });
  const expr = mask(String(reply || ''));
  let scope = null;
  try {
    scope = makeScope({ accountId: 'default', kind: chatType === 'group' ? 'group' : 'private',
      contactId: senderId, groupId: chatType === 'group' ? id : '' }).key;
  } catch { scope = null; }
  const row = {
    at: Number(now), chatId: id, scope,
    affect: { valence: affect.valence, arousal: affect.arousal, label: affect.label },
    expression: { literals: expr.literals.length, markers: markers(String(reply || '')).length },
    shadow: true,
  };
  try {
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, 'persona-shadow.jsonl');
    if (fs.existsSync(file) && fs.statSync(file).size > 2 * 1024 * 1024) {
      try { fs.unlinkSync(file + '.1'); } catch { /* ignore */ }
      fs.renameSync(file, file + '.1');
    }
    fs.appendFileSync(file, JSON.stringify(row) + '\n');
  } catch { /* shadow 失败不影响回复 */ }
  return row;
}

function _reset() { affects.clear(); }
module.exports = { observe, _reset };
