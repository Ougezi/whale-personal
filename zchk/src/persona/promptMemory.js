'use strict';
/**
 * I-02：把 working / session / instruction 接进 prompt。
 *
 * 只做「旁路块」：feature 关闭返回空；任何异常返回空，绝不让 prompt 拼装失败。
 * 按 chatId 隔离；进程内工作记忆（working/session），不写盘。
 */
const features = require('../infra/features');
const {
  createWorkingMemory,
  createSessionMemory,
  createInstructionMemory,
} = require('../../packages/memory-core/working.js');

const MAX_BLOCK_CHARS = 900;
const MAX_STORES = 64;
const stores = new Map();

function storeFor(chatId) {
  const existing = stores.get(chatId);
  if (existing) {
    stores.delete(chatId);
    stores.set(chatId, existing); // LRU touch
    return existing;
  }
  // 只保留最近 64 个 chat；旧 chat 重新进来时重建指令/工作记忆
  while (stores.size >= MAX_STORES) {
    const oldest = stores.keys().next().value;
    if (oldest === undefined) break;
    stores.delete(oldest);
  }
  {
    const instruction = createInstructionMemory();
    instruction.add({ id: 'master', source: 'owner', text: '主人身份优先；群聊/私聊只认主人。' });
    instruction.add({ id: 'no-fake', source: 'owner', text: '不冒充做过没做的事；不确定就说不确定。' });
    instruction.add({ id: 'private', source: 'config', text: '私聊内容不进群；群聊不泄露私聊。' });
    stores.set(chatId, {
      working: createWorkingMemory(),
      session: createSessionMemory(),
      instruction,
    });
  }
  return stores.get(chatId);
}

function buildBlock({ chatId, msg = {}, history = [], isMaster = false, config = null } = {}) {
  try {
    if (!features.isOn(config, 'workingMemory')) return '';
    const id = String(chatId || '');
    if (!id) return '';
    const st = storeFor(id);
    const text = String(msg.cleanText || msg.text || '').replace(/\s+/g, ' ').slice(0, 200);
    if (!text) return '';
    st.working.set('topic', text);
    st.session.add({ role: 'user', text, at: Number(msg.ts) || Date.now(), id: msg.msgId || '' });
    // 带最近一条 assistant，指代“刚才/上一条”时能落到会话
    const lastAssistant = [...history].reverse().find((m) => m && m.role === 'assistant' && m.text);
    if (lastAssistant) st.session.add({ role: 'assistant', text: String(lastAssistant.text).slice(0, 200), at: Date.now() });
    const w = st.working.snapshot();
    const s = st.session.snapshot();
    const scope = msg.chatType === 'group' ? 'group' : 'private';
    const rules = st.instruction.resolve(scope);
    const lines = ['【工作记忆】'];
    if (w.slots.length) lines.push('当前槽：' + w.slots.map((x) => `${x.key}=${x.text}`).join('；'));
    if (s.messages.length) lines.push('最近会话：' + s.messages.slice(-3).map((m) => `${m.role}:${m.text}`).join(' | '));
    if (rules.length) lines.push('行为规则：' + rules.slice(0, 4).map((r) => r.text).join('；'));
    if (isMaster) lines.push('关系：本轮对主人说话。');
    return lines.join('\n').slice(0, MAX_BLOCK_CHARS);
  } catch {
    return '';
  }
}

function _reset() { stores.clear(); }
function _size() { return stores.size; }

module.exports = { buildBlock, _reset, _size, MAX_BLOCK_CHARS, MAX_STORES };
