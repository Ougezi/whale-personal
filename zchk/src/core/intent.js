// 意图分类（第三期，2026-11-24）：规则版，只给提示，不抢现有命令处理
'use strict';

const DELEGATE_RE = /(帮我|替我|给我|去做|去弄|搞定|处理一下|看一下|查一下|跑一下|试一下)/;
const REMIND_RE = /(提醒我|记得|别忘了|到时候|明天.{0,6}(叫我|提醒)|后天.{0,6}(叫我|提醒))/;
const QUESTION_RE = /[?？]|(?:为什么|怎么|是不是|能不能|要不要|可不可以)/;

function classify(text) {
  const s = String(text == null ? '' : text);
  if (REMIND_RE.test(s)) return 'remind';
  if (DELEGATE_RE.test(s)) return 'delegate';
  if (QUESTION_RE.test(s)) return 'question';
  return 'chat';
}

function hint(text) {
  const type = classify(text);
  if (type === 'delegate') return '【意图】主人像是在派活：先判断能不能做，不能做就直说，别硬接。';
  if (type === 'remind') return '【意图】主人在交代要记的事：确认时间和内容，必要时设提醒。';
  return '';
}

module.exports = { classify, hint, DELEGATE_RE, REMIND_RE, QUESTION_RE };
