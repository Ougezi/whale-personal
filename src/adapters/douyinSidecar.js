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

/** 交给 sidecar：打开链接，返回 {"ok":true,"title":...,"frameFile":...} */
function readLink(url, { timeoutMs = 180000, seekTo = 2 } = {}) {
  if (!available()) return Promise.reject(new Error('抖音 sidecar 不可用（缺 service.mjs / runtime）'));
  const env = { ...process.env, DSH_HOME: path.join(DIR, 'state') };
  return new Promise((resolve, reject) => {
    execFile(NODE, [ENTRY, '--once', 'link', JSON.stringify({ url, seekTo })], {
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

module.exports = { available, readLink, DIR, ENTRY };
