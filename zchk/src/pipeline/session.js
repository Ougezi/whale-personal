// 会话与会话上下文（2026-11-22 从 pipeline/chat.js 抽出）
// 定位：只做「消息归一化 / 历史拼装 / 兜底上下文」这些与模型无关的事，
// 不碰触发、不碰模型调用，方便单测和替换。
'use strict';

const context = require('../core/context');
const time = require('../infra/time');
const { usesNewPersona } = require('../persona/profile');

function sessionKey(msg) {
  const type = msg.chatType === 'group' ? 'g' : 'u';
  return `${msg.platform}:${type}:${msg.chatId}`;
}

function normalize(msg) {
  const at = msg.atMe === true || msg.atMe === 1 || msg.atMe === '1' || msg.atMe === 'true';
  return {
    platform: String(msg.platform || 'web').slice(0, 20),
    chatId: String(msg.chatId ?? 'default').slice(0, 120),
    chatType: msg.chatType === 'group' ? 'group' : 'private',
    senderId: String(msg.senderId ?? 'anonymous').slice(0, 100),
    senderName: String(msg.senderName ?? '群友').slice(0, 60),
    text: String(msg.text ?? '').slice(0, 2000),
    atMe: at,
    msgId: msg.msgId ? String(msg.msgId).slice(0, 120) : '',
    chatTitle: msg.chatTitle ? String(msg.chatTitle).slice(0, 60) : '',
    replyToBot: msg.replyToBot === true,
    replyToName: String(msg.replyToName || msg.reply_to_name || '').slice(0, 60),
    replyToUserId: String(msg.replyToUserId || msg.reply_to_user_id || '').slice(0, 100),
    mentionedNames: (Array.isArray(msg.mentionedNames) ? msg.mentionedNames : Array.isArray(msg.mention_names) ? msg.mention_names : [])
      .map((x) => String(x && typeof x === 'object' ? (x.name || x.nickname || '') : x).trim()).filter(Boolean).slice(0, 4),
    selfNames: (Array.isArray(msg.selfNames) ? msg.selfNames : Array.isArray(msg.self_names) ? msg.self_names : [])
      .map((x) => String(x || '').trim()).filter(Boolean).slice(0, 20),
  };
}

/** 最近别人说过的原话（含当前这条），用来判断她是不是在复读 */
function recentHeard(self, decision, limit = 6) {
  const msg = (decision && decision.msg) || {};
  const list = [];
  const current = String(msg.cleanText || msg.text || '').trim();
  if (current) list.push(current);
  try {
    const key = decision && decision.key;
    if (key) {
      const recent = self.store.messages(key, 20)
        .filter((m) => m.role === 'user' && m.text)
        .map((m) => String(m.text).trim())
        .filter((t) => t && t !== current);
      list.push(...recent.slice(-limit));
    }
  } catch { /* ignore */ }
  return list;
}

/** 她最近说过的几句，用来避免自己复读自己 */
function recentOwn(self, decision, limit = 4) {
  try {
    const key = decision && decision.key;
    if (!key) return [];
    return self.store.messages(key, 20)
      .filter((m) => m.role === 'assistant' && m.text && !m.error)
      .map((m) => String(m.text).trim())
      .slice(-limit);
  } catch {
    return [];
  }
}

function buildTurns(self, msg, history, memoryBlock, tailBlock) {
  return context.buildTurns(
    { ...msg, botName: self.config.persona.name, newPersonaBehavior: msg.newPersonaBehavior ?? usesNewPersona(self.config) },
    history,
    memoryBlock,
    tailBlock,
    time.resolveTimeZone(self.config)
  );
}

/** 记忆拉取失败时的兜底上下文：整块放弃记忆，只带最近原文 */
function recentOnlyContext(self, key, { isGroup = false } = {}) {
  const chat = (self.config && self.config.chat) || {};
  const configured = Number(isGroup ? chat.groupHistoryTurns : chat.historyTurns) || 20;
  const cap = Math.max(4, Math.min(800, configured));
  let recent = [];
  try {
    recent = (self.store.messages(key, cap) || []).filter((m) => m && m.text && !m.error);
  } catch { /* 连原文都读不出来就只回当前这条 */ }
  const kept = [];
  let chars = 0;
  for (let i = recent.length - 1; i >= 0; i -= 1) {
    const len = String(recent[i].text || '').length;
    if (kept.length && chars + len > 6000) break;
    kept.unshift(recent[i]);
    chars += len;
  }
  return {
    chatId: key, card: null, events: [], block: '', relationsBlock: '', relations: [],
    mentions: [], summary: '', recent: kept, recentTokens: 0, summaryTokens: 0,
    memoryTokens: 0, relationsTokens: 0, notes: [], memoryFailed: true,
  };
}

module.exports = { sessionKey, normalize, recentHeard, recentOwn, buildTurns, recentOnlyContext };
