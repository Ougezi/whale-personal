// 动态提示词预算（第二期，2026-11-24）：心情/念头/牵挂/称呼/指代/意图/技能
// 这些是每轮追加的，必须有上限，否则功能越加 prompt 越胖。
'use strict';

const DROP_ORDER = ['skill', 'coref', 'intent', 'nick', 'empathy'];
const DEFAULT_MAX_CHARS = 1200;   // 约 600 个汉字 token

function fitBlocks(blocks, { maxChars = DEFAULT_MAX_CHARS } = {}) {
  let list = (Array.isArray(blocks) ? blocks : []).filter((b) => b && b.text);
  const size = () => list.reduce((n, b) => n + String(b.text).length + 1, 0);
  for (const key of DROP_ORDER) {
    if (size() <= maxChars) break;
    list = list.filter((b) => b.key !== key);
  }
  let out = list.map((b) => b.text).join('\n');
  if (out.length > maxChars) out = out.slice(0, maxChars);
  return out;
}

module.exports = { fitBlocks, DEFAULT_MAX_CHARS, DROP_ORDER };
