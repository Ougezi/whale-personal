'use strict';
/** I-30：scope shadow，只验证 canRecall fail-closed，不改真实召回。 */
const fs = require('node:fs');
const path = require('node:path');
const { makeScope, canRecall } = require('../../packages/persona-core/scope.js');

function allowed(chatId, chats) {
  if (chats === undefined) return true;
  return Array.isArray(chats) && chats.map(String).includes(String(chatId));
}

function observe({ dataDir, chatId, chatType = 'private', senderId = '', chats = undefined, now = Date.now() } = {}) {
  const id = String(chatId || '').trim();
  const dir = String(dataDir || '').trim();
  if (!id || !dir) return null;
  if (!allowed(id, chats)) return null;
  const kind = chatType === 'group' ? 'group' : 'private';
  const base = { platform: 'wechat', accountId: 'default', personaId: 'default', kind };
  let viewer, other;
  try {
    viewer = makeScope({ ...base, contactId: kind === 'private' ? senderId || id : '', groupId: kind === 'group' ? id : '' });
    other = kind === 'private'
      ? makeScope({ ...base, kind: 'private', contactId: '__other__' })
      : makeScope({ ...base, kind: 'group', groupId: '__other__' });
  } catch (e) { return null; }
  const selfRecall = canRecall(viewer, viewer);
  const cross = canRecall(viewer, other);
  const row = { at: Number(now), chatId: id, kind, viewer: viewer.key, selfRecall, crossRecall: cross, failClosed: selfRecall && !cross };
  try {
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, 'scope-shadow.jsonl');
    if (fs.existsSync(file) && fs.statSync(file).size > 2 * 1024 * 1024) {
      try { fs.unlinkSync(file + '.1'); } catch { /* ignore */ }
      fs.renameSync(file, file + '.1');
    }
    fs.appendFileSync(file, JSON.stringify(row) + '\n');
  } catch { /* shadow 失败不影响召回 */ }
  return row;
}

module.exports = { observe };
