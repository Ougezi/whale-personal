// 回复里的标记处理（2026-11-22 从 pipeline/chat.js 抽出）
// 约定：只做「识别标记 → 收走 / 展开」，不碰发送和模型。
'use strict';

const path = require('node:path');
const innerNotes = require('../core/innerNotes');

function dataDirOf(self) {
  return (self.config && self.config.paths && self.config.paths.dataDir) || path.join(process.cwd(), 'data');
}

/** [[feel:…]] / [[lesson:…]]：写进 data/inner/ 并从正文收走 */
function consumeInner(self, decision, text) {
  try {
    const parsed = innerNotes.consume(text, { dir: dataDirOf(self) });
    if (parsed.writes.length && self.logger) {
      self.logger.info('内心记录：' + parsed.writes.map((w) => w.kind).join('、'));
    }
    return parsed.text;
  } catch (err) {
    return text;
  }
}

/** [[feel:read]] / [[lesson:read]]：把写过的读出来（只对主人私聊生效） */
function expandInnerRead(self, decision, text) {
  const msg = (decision && decision.msg) || {};
  const allowed = Boolean(msg.isMaster && msg.chatType === 'private');
  return String(text == null ? '' : text)
    .replace(/\[\[(feel|lesson)\s*[:：]\s*(?:read|读取)\s*\]\]/gi, (all, kind) => {
      if (!allowed) return '';
      try {
        const body = innerNotes.describe(String(kind).toLowerCase(), 8, { dir: dataDirOf(self) });
        return body ? '我记下的：\n' + body : '（还没写过）';
      } catch {
        return '（读不到）';
      }
    })
    .trim();
}

/** [[diary:日期]]：把日记原文替换进来（只对主人私聊生效） */
function expandDiary(self, decision, text) {
  const msg = (decision && decision.msg) || {};
  const allowed = Boolean(self.diary && msg.isMaster && msg.chatType === 'private');
  return String(text == null ? '' : text).replace(/\[\[diary:([^\]]{1,32})\]\]/gi, (all, token) => {
    if (!allowed) return '';
    try {
      return self.diary.readForChat(String(token || '').trim()) || '（没找到那天的日记）';
    } catch {
      return '（没找到那天的日记）';
    }
  }).trim();
}

module.exports = { consumeInner, expandInnerRead, expandDiary };
