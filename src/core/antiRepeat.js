// 反重复语料（I5，2026-11-23）：自己的常用短句换个说法
'use strict';

const REPLACE = {
  好的: ['好', '行', '成'],
  可以: ['行', '成'],
  哈哈: ['嘿嘿', '笑死'],
  谢谢: ['谢啦', '多谢'],
  在呢: ['在的', '来了'],
  晚安: ['睡了', '去睡啦'],
};

function pick(text, recent = [], rng = Math.random) {
  const t = String(text == null ? '' : text).trim();
  const opts = REPLACE[t];
  if (!opts || !opts.length) return text;
  const used = (Array.isArray(recent) ? recent : []).some((r) => String(r || '').trim() === t);
  if (!used) return text;
  const idx = Math.min(opts.length - 1, Math.floor(Math.max(0, Math.min(0.999, rng())) * opts.length));
  return opts[idx] || text;
}

module.exports = { pick, REPLACE };
