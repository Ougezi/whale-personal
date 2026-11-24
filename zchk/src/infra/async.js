// 异步小工具（S4，2026-11-23）
'use strict';

/** 超时返回 fallback，不抛错；用于"超时就降级"的场景 */
function withTimeout(promise, ms, fallback = null) {
  let timer = null;
  const slow = new Promise((resolve) => {
    timer = setTimeout(() => resolve(fallback), Math.max(1, Number(ms) || 1));
    if (timer.unref) timer.unref();
  });
  return Promise.race([Promise.resolve(promise), slow]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

module.exports = { withTimeout };
