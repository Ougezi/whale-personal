// 记忆召回：把 buildContext 的调用与失败格式收敛到一处（2026-11 拆自 chat.js）
'use strict';

const { describeError } = require('../infra/errors');

/**
 * 安全召回。失败不抛：返回 { ok:false, error, detail }，调用方决定怎么兜底。
 * @param {object} store 记忆门面
 * @param {object} params buildContext 参数
 * @param {object} [opts] { logger, onceLogged } —— onceLogged=true 时只留一行摘要
 */
async function recallMemory(store, params, opts = {}) {
  try {
    const mem = await store.buildContext(params);
    return { ok: true, mem };
  } catch (err) {
    const info = describeError(err);
    const detail = opts.onceLogged ? info : `${info}\n${(err && err.stack) || ''}`;
    return { ok: false, error: err, info, detail };
  }
}

module.exports = { recallMemory };
