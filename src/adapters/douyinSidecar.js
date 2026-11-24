'use strict';

/**
 * 抖音 sidecar 客户端（一次性进程）。
 * sidecar 在 D:\\dsh\\profiles\\desktop\\whale-douyin，有自己的 Chrome profile / 登录态 / 配额；
 * 这里只负责把一条链接交给它，拿回标题、作者、文案、话题和一张截图。
 */

const { execFile } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const DIR = process.env.WHALE_DOUYIN_DIR || 'D:\\dsh\\profiles\\desktop\\whale-douyin';
const ENTRY = path.join(DIR, 'service.mjs');
const NODE = (() => {
  const p = path.join(__dirname, '..', '..', 'runtime', 'node.exe');
  return fs.existsSync(p) ? p : process.execPath;
})();
const MARK = '@@RESULT@@';

function available() {
  return fs.existsSync(ENTRY) && fs.existsSync(NODE);
}

/** 通用：执行 sidecar 的任意 op（watch/hot/download/user/comments/...） */
function run(op, args = {}, { timeoutMs = 240000 } = {}) {
  if (!available()) return Promise.reject(new Error('抖音 sidecar 不可用（缺 service.mjs / runtime）'));
  const env = { ...process.env, DSH_HOME: process.env.WHALE_DOUYIN_HOME || path.join(DIR, 'state') };
  return new Promise((resolve, reject) => {
    execFile(NODE, [ENTRY, '--once', String(op || 'status'), JSON.stringify(args || {})], {
      cwd: DIR,
      env,
      timeout: timeoutMs,
      maxBuffer: 4 * 1024 * 1024,
      windowsHide: true,
    }, (err, stdout) => {
      if (err && !stdout) return reject(err);
      const line = String(stdout || '').split('\n').find((l) => l.startsWith(MARK));
      if (!line) return reject(new Error('sidecar 没有返回结果'));
      try { resolve(JSON.parse(line.slice(MARK.length))); } catch (e) { reject(e); }
    });
  });
}

/** 打开一条链接（readLink 的旧签名，保留） */
function readLink(url, { timeoutMs = 180000, seekTo = 2 } = {}) {
  return run('link', { url, seekTo }, { timeoutMs });
}

module.exports = { available, run, readLink, DIR, ENTRY };
