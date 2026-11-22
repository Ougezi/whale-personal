// 思考分级：复杂消息才开 thinking，简单句保持关闭省钱（2026-11 拆分自 chat.js）
'use strict';

const COMPLEX_RE = /为什么|怎么办|你觉得|记得|是不是|要不要|分析|理解|怎么会/;

/** 返回 true / undefined：undefined 表示沿用全局设置（关）。 */
function shouldThink(config, msg) {
  const mode = String((config && config.deepseek && config.deepseek.thinkingMode) || 'auto');
  if (mode === 'off') return undefined;
  if (mode === 'on') return true;
  const t = String((msg && (msg.cleanText || msg.text)) || '');
  const complex = t.length >= 40
    || COMPLEX_RE.test(t)
    || t.split(/[。！？!?]/).filter(Boolean).length >= 2;
  return complex || undefined;
}

module.exports = { shouldThink, COMPLEX_RE };
