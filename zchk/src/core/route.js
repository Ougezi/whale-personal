// 复杂问题判定（第三期，2026-11-24）：纯函数，方便测试
'use strict';

function isComplex(text, route = {}) {
  const s = String(text == null ? '' : text);
  if (!route || !route.enabled) return false;
  if (s.length >= (Number(route.minChars) || 200)) return true;
  const kws = Array.isArray(route.keywords) ? route.keywords : [];
  return kws.some((k) => k && s.includes(String(k)));
}

module.exports = { isComplex };
