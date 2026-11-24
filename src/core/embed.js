'use strict';
/**
 * 本地嵌入客户端（P4）
 *
 * 模型跑在独立子进程里（data/vector/embed-server.mjs），这里只负责按行发文本、收向量。
 * 失败一律降级：拿不到向量就返回 null，检索退回纯 BM25，不影响聊天。
 */

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

// 用 __dirname 推导应用根，不能依赖 cwd：换工作目录/从别处启动时
// 原实现会去 cwd/data/vector 找模型、去 cwd/runtime 找 node，向量检索静默失效。
const ROOT = path.resolve(__dirname, '..', '..');
const VEC_DIR = path.join(ROOT, 'data', 'vector');
const SERVER = path.join(VEC_DIR, 'embed-server.mjs');
const NODE = path.join(ROOT, 'runtime', 'node.exe');

let child = null;
let seq = 0;
const pending = new Map();
let broken = false;
let lastUsed = 0;

function available() {
  try {
    return !broken
      && fs.existsSync(NODE)
      && fs.existsSync(SERVER)
      && fs.existsSync(path.join(VEC_DIR, 'node_modules', '@huggingface', 'transformers', 'package.json'));
  } catch {
    return false;
  }
}

function ensureChild(logger) {
  if (child && child.exitCode === null) return child;
  if (!available()) return null;
  try {
    child = spawn(NODE, [SERVER], {
      cwd: VEC_DIR,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let buf = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      buf += chunk;
      let idx = buf.indexOf('\n');
      while (idx >= 0) {
        const line = buf.slice(0, idx).trim();
        buf = buf.slice(idx + 1);
        idx = buf.indexOf('\n');
        if (!line) continue;
        let msg = null;
        try {
          msg = JSON.parse(line);
        } catch {
          continue;
        }
        if (msg && msg.ready) continue;
        const slot = pending.get(msg && msg.id);
        if (slot) {
          pending.delete(msg.id);
          clearTimeout(slot.timer);
          if (msg.ok && Array.isArray(msg.vectors)) slot.resolve(msg.vectors);
          else slot.resolve(null);
        }
      }
    });
    child.stderr.on('data', (d) => {
      if (logger) logger.warn('嵌入进程 stderr：' + String(d).slice(0, 200));
    });
    child.on('exit', () => {
      for (const [, slot] of pending) slot.resolve(null);
      pending.clear();
      child = null;
    });
    child.on('error', () => {
      broken = true;
      child = null;
    });
    return child;
  } catch (err) {
    broken = true;
    return null;
  }
}

/**
 * 把一批文本编码成向量。失败/不可用返回 null（调用方必须能接受）。
 * @param {string[]} texts
 * @param {{logger?:object, timeoutMs?:number}} [opts]
 * @returns {Promise<number[][]|null>}
 */
function embed(texts, opts = {}) {
  const list = (Array.isArray(texts) ? texts : []).map((t) => String(t || '').slice(0, 512));
  if (!list.length) return Promise.resolve([]);
  const proc = ensureChild(opts.logger);
  if (!proc) return Promise.resolve(null);
  const id = ++seq;
  lastUsed = Date.now();
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      resolve(null);
    }, Number(opts.timeoutMs) || 20000);
    pending.set(id, { resolve, timer });
    try {
      proc.stdin.write(JSON.stringify({ id, texts: list }) + '\n');
    } catch {
      clearTimeout(timer);
      pending.delete(id);
      resolve(null);
    }
  });
}

function cosine(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  let s = 0;
  for (let i = 0; i < a.length; i += 1) s += a[i] * b[i];
  return s;
}

/** 主动收掉子进程（内核退出、自测脚本收尾时用） */
function stop() {
  try {
    if (child && child.exitCode === null) child.kill();
  } catch {
    // 已经退出了
  }
  child = null;
}

// 进程退出时不要留孤儿嵌入进程
process.on('exit', stop);

module.exports = {
  VEC_DIR, NODE, SERVER, available, embed, cosine, stop, VEC_DIR, SERVER, idleSince: () => lastUsed };
