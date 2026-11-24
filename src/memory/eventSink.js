'use strict';
/**
 * 主链接入 I-01：把 ChatStore 的每条消息旁路写进 append-only 事件日志。
 *
 * 设计：
 *  - 只在 features.eventLog 开启时由 app 注入；
 *  - eventSink 失败只记日志，绝不影响旧 messages.jsonl / 聊天主链；
 *  - event.id 幂等，重复写不会产生第二行。
 */
const { createEventStore } = require('../../packages/memory-core/events.js');

function createEventSink({ file, logger = null, enabled = true } = {}) {
  if (!file) throw new Error('eventSink file required');
  const store = createEventStore({ file });
  function append(entry, chat = {}) {
    const on = typeof enabled === 'function' ? enabled() : enabled !== false;
    if (!on) return { skipped: true, reason: 'disabled' };
    const id = 'chat:' + entry.chatId + ':' + entry.id;
    const event = {
      id,
      type: entry.role === 'assistant' ? 'message.sent' : 'message.received',
      at: Number(entry.ts) || 0,
      source: { kind: 'chat', ref: String(entry.msgId || entry.id) },
      scope: {
        platform: String(chat.platform || 'wechat'),
        chat: String(entry.chatId),
        visibility: chat.chatType === 'group' ? 'group' : 'private',
      },
      payload: {
        role: entry.role,
        name: entry.name || '',
        text: entry.text || '',
        seq: Number(entry.seq) || 0,
      },
      evidence: [String(entry.id)],
    };
    return store.append(event);
  }
  return { append, stats: () => store.stats(), file };
}

module.exports = { createEventSink };
