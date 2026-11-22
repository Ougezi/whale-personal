'use strict';

/**
 * 网页抓取 + 浏览器渲染。
 * - 先走 HTTP 直连（快，拿 og/正文/标题）；
 * - 正文太少（SPA、需要 JS）或直连失败时，起一个 headless 浏览器，用 CDP 拿 document.body.innerText；
 * - 私网地址默认拒绝（和 links.js 一致），避免被当成内网探针。
 *
 * 为什么用 CDP 而不是 `--dump-dom`：这台机器的 Chrome 157 / Edge 都不再往 stdout 打 DOM
 * （实测各种 headless 组合都是 0 字节），但 remote debugging 可用，所以用 /json/new + WebSocket。
 */

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');

const links = require('./links');

const BROWSERS = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
];

function findBrowser() {
  for (const exe of BROWSERS) {
    try { if (fs.existsSync(exe)) return exe; } catch { /* ignore */ }
  }
  return '';
}

function browserAvailable() {
  return Boolean(findBrowser());
}

function squash(text) {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const port = srv.address().port;
      srv.close(() => resolve(port));
    });
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let shared = null; // { child, port, profile, startedAt }

async function launchBrowser({ timeoutMs = 12000 } = {}) {
  if (shared && shared.child && !shared.child.killed) return shared;
  const exe = findBrowser();
  if (!exe) throw new Error('本机没有可用的 Chrome/Edge');
  const port = await freePort();
  const profile = path.join(os.tmpdir(), 'whale-cdp-' + Date.now().toString(36) + Math.random().toString(16).slice(2, 6));
  const child = spawn(exe, [
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--mute-audio',
    '--disable-background-networking',
    '--user-data-dir=' + profile,
    '--remote-debugging-port=' + port,
    'about:blank',
  ], { stdio: 'ignore', windowsHide: true });
  shared = { child, port, profile, startedAt: Date.now() };
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch('http://127.0.0.1:' + port + '/json/version');
      if (res.ok) return shared;
    } catch { /* 还没起来 */ }
    await sleep(200);
  }
  shutdownBrowser();
  throw new Error('浏览器启动超时');
}

function shutdownBrowser() {
  if (!shared) return;
  const { child, profile } = shared;
  shared = null;
  try { child.kill(); } catch { /* ignore */ }
  setTimeout(() => { try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* ignore */ } }, 1500);
}

/** 在浏览器里打开 url，返回 title / innerText */
async function renderPage(url, { timeoutMs = 20000, maxChars = 6000 } = {}) {
  const { port } = await launchBrowser({ timeoutMs });
  const create = await fetch('http://127.0.0.1:' + port + '/json/new?' + encodeURIComponent(url), { method: 'PUT' });
  if (!create.ok) throw new Error('打开页面失败：HTTP ' + create.status);
  const target = await create.json();
  const wsUrl = target.webSocketDebuggerUrl;
  if (!wsUrl) throw new Error('没有拿到调试地址');
  const ws = new WebSocket(wsUrl);
  const pending = new Map();
  let nextId = 1;
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
    setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error(method + ' 超时')); } }, timeoutMs);
  });
  const loaded = new Promise((resolve) => {
    const timer = setTimeout(resolve, Math.min(9000, timeoutMs));
    ws.addEventListener('message', (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        if (msg.method === 'Page.loadEventFired') { clearTimeout(timer); resolve(); }
      } catch { /* ignore */ }
    });
  });
  try {
    await new Promise((resolve, reject) => {
      ws.addEventListener('open', resolve, { once: true });
      ws.addEventListener('error', () => reject(new Error('调试通道连接失败')), { once: true });
      setTimeout(() => reject(new Error('调试通道连接超时')), timeoutMs);
    });
    ws.addEventListener('message', (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        if (msg.id && pending.has(msg.id)) {
          const p = pending.get(msg.id);
          pending.delete(msg.id);
          if (msg.error) p.reject(new Error(msg.error.message || 'CDP 错误'));
          else p.resolve(msg.result);
        }
      } catch { /* ignore */ }
    });
    await send('Page.enable');
    await send('Page.navigate', { url });
    await loaded;
    const title = await send('Runtime.evaluate', { expression: 'document.title || ""', returnByValue: true });
    const body = await send('Runtime.evaluate', {
      expression: 'document.body ? document.body.innerText : ""',
      returnByValue: true,
    });
    const text = squash(body && body.result && body.result.value).slice(0, maxChars);
    if (!text) throw new Error('浏览器渲染后没有正文');
    return {
      ok: true,
      url,
      method: 'browser',
      title: squash(title && title.result && title.result.value).slice(0, 120),
      text,
    };
  } finally {
    try { ws.close(); } catch { /* ignore */ }
    try { await fetch('http://127.0.0.1:' + port + '/json/close/' + target.id); } catch { /* ignore */ }
  }
}

/** HTTP 直连读一页（复用 links 的抓取 + 解析） */
async function httpPage(url, { timeoutMs = 12000, maxChars = 6000 } = {}) {
  const info = await links.describeLink(url, { timeoutMs, cacheMinutes: 0, allowPrivate: false });
  if (!info || !info.ok) return { ok: false, url, method: 'http', error: (info && info.error) || '读取失败' };
  const text = String(info.text || info.summary || '').slice(0, maxChars);
  return { ok: Boolean(text), url, method: 'http', title: info.title || '', text, error: text ? '' : '没有正文' };
}

/** 打开一个页面：先 HTTP，正文太短再上浏览器；prefer='browser' 直接渲染 */
async function openPage(url, { timeoutMs = 12000, prefer = 'auto', maxChars = 6000 } = {}) {
  const target = String(url || '').trim();
  if (!/^https?:\/\//i.test(target)) return { ok: false, url: target, method: 'none', error: '只支持 http/https 地址' };
  if (links.isPrivateHost(target)) return { ok: false, url: target, method: 'none', error: '内网/本机地址不允许抓取' };

  if (prefer === 'browser') {
    try { return await renderPage(target, { timeoutMs: Math.max(8000, timeoutMs), maxChars }); }
    catch (err) { return { ok: false, url: target, method: 'browser', error: String((err && err.message) || err) }; }
  }

  let http = null;
  try { http = await httpPage(target, { timeoutMs, maxChars }); } catch { http = null; }
  if (http && http.ok && http.text.length >= 160) return http;
  try {
    const page = await renderPage(target, { timeoutMs: Math.max(8000, timeoutMs), maxChars });
    if (!http || !http.ok || String(page.text || '').length > String(http.text || '').length) return page;
    return http;
  } catch (err) {
    if (http && http.ok) return http;
    return { ok: false, url: target, method: 'http', error: String((err && err.message) || err) };
  }
}

module.exports = { findBrowser, browserAvailable, renderPage, httpPage, openPage, shutdownBrowser };