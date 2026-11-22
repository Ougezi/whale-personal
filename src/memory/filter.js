// 选择性入库（M1，2026-11-23）：不是每句话都值得记
// 只影响「从消息里抽取事实/事件」，原文仍然全量落盘（messages.jsonl），不丢上下文。
'use strict';

const EMOJI_ONLY = /^[\p{Extended_Pictographic}\p{Emoji_Presentation}\s!?？。，、~～.…]+$/u;

function worthRemembering(text, msg = {}) {
  const s = String(text == null ? '' : text).replace(/\s+/g, ' ').trim();
  if (s.length < 4) return false;
  if (EMOJI_ONLY.test(s)) return false;
  // 去掉 @ 和 [表情] 之后还剩多少信息
  const core = s.replace(/@\S{1,20}/g, '').replace(/\[[^\]]{1,6}\]/g, '').trim();
  if (!core) return false;
  if (core.length < 3) return false;
  if (/^(?:哈哈+|嗯+|哦+|好+|收到|在吗|在不在|666+|笑死)[。.!！?？~～]*$/.test(core)) return false;
  return true;
}

module.exports = { worthRemembering };
