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

const { spawn, execFile } = require('node:child_process');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');

const links = require('./links');

// 持久 profile：保留 Cookie / 登录态（下次打开同一站点还是登录状态）。
// 想换目录可以设环境变量 WHALE_BROWSER_PROFILE。
const PROFILE_DIR = process.env.WHALE_BROWSER_PROFILE || path.join(process.cwd(), 'data', 'browser-profile');

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
let idleTimer = null;
// 浏览器只在真的用的时候活着：5 分钟没人用就关掉，别在后台常驻一个 Chrome
function scheduleIdleShutdown() {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => shutdownBrowser(), 5 * 60 * 1000);
  if (idleTimer.unref) idleTimer.unref();
}

async function launchBrowser({ timeoutMs = 12000, allowTempProfile = true } = {}) {
  if (shared && shared.child && !shared.child.killed) return shared;
  const profileDir = PROFILE_DIR;
  const exe = findBrowser();
  if (!exe) throw new Error('本机没有可用的 Chrome/Edge');
  const port = await freePort();
  const profile = profileDir;
  try { fs.mkdirSync(profile, { recursive: true }); } catch { /* 目录建不出来就让浏览器自己报错 */ }
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
  // profile 可能被另一个 Chrome 占着（比如你自己开着登录窗口）：退回临时 profile，别让抓取整个失败
  if (allowTempProfile && profileDir === PROFILE_DIR) {
    const temp = path.join(os.tmpdir(), 'whale-cdp-tmp-' + Date.now().toString(36));
    try {
      const port2 = await freePort();
      const child2 = spawn(findBrowser(), ['--headless=new','--disable-gpu','--no-sandbox','--no-first-run','--user-data-dir=' + temp,'--remote-debugging-port=' + port2,'about:blank'], { stdio: 'ignore', windowsHide: true });
      shared = { child: child2, port: port2, profile: temp, startedAt: Date.now() };
      const deadline2 = Date.now() + timeoutMs;
      while (Date.now() < deadline2) {
        try { const r2 = await fetch('http://127.0.0.1:' + port2 + '/json/version'); if (r2.ok) return shared; } catch { /* 还在起 */ }
        await sleep(200);
      }
      shutdownBrowser();
    } catch { /* 落回下面统一报错 */ }
  }
  throw new Error('浏览器启动超时');
}

function shutdownBrowser() {
  if (!shared) return;
  const { child, profile } = shared;
  shared = null;
  if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
  try { child.kill(); } catch { /* ignore */ }
  // 持久 profile 不清：下次还带着登录态
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
  if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
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
    scheduleIdleShutdown();
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
async function openPage(url, opts = {}) {
  const startedAt = Date.now();
  const page = await openPageInner(url, opts);
  page.ms = Date.now() - startedAt;
  page.profile = PROFILE_DIR;
  return page;
}

async function openPageInner(url, { timeoutMs = 12000, prefer = 'auto', maxChars = 6000 } = {}) {
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



// ---- 视频：从页面里找视频地址，抓几帧交给视觉模型 ----

function findFfmpeg() {
  const candidates = [
    process.env.WHALE_FFMPEG || '',
    path.join(process.env.LOCALAPPDATA || '', 'Programs', 'ffmpeg', 'bin', 'ffmpeg.exe'),
    'C:\\ffmpeg\\bin\\ffmpeg.exe',
    'ffmpeg',
  ].filter(Boolean);
  for (const exe of candidates) {
    try { if (exe === 'ffmpeg' || fs.existsSync(exe)) return exe; } catch { /* ignore */ }
  }
  return '';
}

function ffmpegFrames(file, ffmpeg, { count = 3, timeoutMs = 20000 } = {}) {
  return new Promise((resolve, reject) => {
    const outDir = path.join(os.tmpdir(), 'whale-frames-' + Date.now().toString(36));
    fs.mkdirSync(outDir, { recursive: true });
    const pattern = path.join(outDir, 'f%02d.jpg');
    // 取前几秒的几帧（-vf fps 均匀抽帧），比按时间点 seek 更不容易在黑屏/片头
    const args = ['-y', '-i', file, '-vf', 'fps=1/2', '-frames:v', String(count), '-q:v', '3', pattern];
    execFile(ffmpeg, args, { timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024 }, (err) => {
      try {
        if (err) return reject(err);
        const files = fs.readdirSync(outDir).filter((f) => f.endsWith('.jpg')).sort();
        const frames = files.map((f) => fs.readFileSync(path.join(outDir, f)).toString('base64'));
        fs.rmSync(outDir, { recursive: true, force: true });
        if (!frames.length) return reject(new Error('没抽到帧'));
        resolve(frames);
      } catch (e) { reject(e); }
    });
  });
}

/** 在页面里找 http(s) 视频地址（video.currentSrc / og:video / source） */
async function videoSource(url, { timeoutMs = 20000 } = {}) {
  const { port } = await launchBrowser({ timeoutMs });
  const create = await fetch('http://127.0.0.1:' + port + '/json/new?' + encodeURIComponent(url), { method: 'PUT' });
  if (!create.ok) throw new Error('打开页面失败：HTTP ' + create.status);
  const target = await create.json();
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  const pending = new Map();
  let nextId = 1;
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
    setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error(method + ' 超时')); } }, timeoutMs);
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
          const p2 = pending.get(msg.id);
          pending.delete(msg.id);
          if (msg.error) p2.reject(new Error(msg.error.message || 'CDP 错误'));
          else p2.resolve(msg.result);
        }
      } catch { /* ignore */ }
    });
    await send('Page.enable');
    await send('Page.navigate', { url });
    await new Promise((r) => setTimeout(r, 4000));
    const res = await send('Runtime.evaluate', {
      expression: `(() => {
        const out = [];
        document.querySelectorAll('video').forEach((v) => out.push(v.currentSrc || v.src || ''));
        document.querySelectorAll('source').forEach((x) => out.push(x.src || ''));
        document.querySelectorAll('meta').forEach((m) => {
          const prop = m.getAttribute('property') || m.getAttribute('name') || '';
          if (/og:video|twitter:player:stream/i.test(prop)) out.push(m.content || '');
        });
        return out.filter((u) => /^https?:/.test(u));
      })()`,
      returnByValue: true,
    });
    if (res && res.exceptionDetails) throw new Error('页面求值失败：' + JSON.stringify(res.exceptionDetails).slice(0, 160));
    const list = (res && res.result && res.result.value) || [];
    // 有些站点（抖音分享页）把播放地址藏在页面 JSON 里，DOM 查不到就扫一遍 HTML
    try {
      const htmlRes = await send('Runtime.evaluate', { expression: 'document.documentElement.innerHTML.slice(0, 2000000)', returnByValue: true });
      const html = String((htmlRes && htmlRes.result && htmlRes.result.value) || '');
      const urls = html.match(/https?:[^"'\\\s]+/g) || [];
      for (const u of urls) {
        if (/play_addr|playwm|\/video\/tos\/|\.mp4/i.test(u) && !list.includes(u)) list.push(u.replace(/\\u002F/g, '/'));
      }
    } catch { /* HTML 扫不到就算了 */ }
    return list;
  } finally {
    try { ws.close(); } catch { /* ignore */ }
    try { await fetch('http://127.0.0.1:' + port + '/json/close/' + target.id); } catch { /* ignore */ }
  }
}

/** 抓到视频就抽帧，交给调用方的 describeImage 变成文字 */
async function describeVideo(url, { describeImage = null, count = 3, maxBytes = 40 * 1024 * 1024, timeoutMs = 25000 } = {}) {
  const ffmpeg = findFfmpeg();
  if (!ffmpeg) return { ok: false, error: '本机没有 ffmpeg' };
  let candidates = [];
  try { candidates = await videoSource(url, { timeoutMs }); } catch (err) { return { ok: false, error: '找视频地址失败：' + ((err && err.message) || err) }; }
  if (!candidates.length) return { ok: false, error: '页面里没有可直接下载的视频地址（抖音常见 blob/MSE，需要登录或专用接口）' };
  const headers = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/157.0 Safari/537.36', Referer: url };
  let lastErr = null;
  for (const src of candidates.slice(0, 3)) {
    try {
      const res = await fetch(src, { headers, signal: AbortSignal.timeout(timeoutMs) });
      if (!res.ok) continue;
      const len = Number(res.headers.get('content-length') || 0);
      if (len > maxBytes) continue;
      const buf = Buffer.from(await res.arrayBuffer());
      const ctype = String(res.headers.get('content-type') || '');
      const isVideoPayload = /^video\//i.test(ctype) || (buf.length > 12 && buf.slice(4, 8).toString('ascii') === 'ftyp');
      if (!isVideoPayload) { lastErr = new Error('拿到的不是视频文件（' + (ctype || '未知类型') + '）'); continue; }
      if (!buf.length || buf.length > maxBytes) continue;
      const file = path.join(os.tmpdir(), 'whale-video-' + Date.now() + '.mp4');
      fs.writeFileSync(file, buf);
      let frames = [];
      try { frames = await ffmpegFrames(file, ffmpeg, { count }); } finally { try { fs.unlinkSync(file); } catch { /* ignore */ } }
      if (!frames.length) continue;
      const seen = [];
      for (const b64 of frames) {
        if (!describeImage) continue;
        try { const d = await describeImage(b64); if (d) seen.push(String(d).slice(0, 300)); } catch { /* 单帧失败不影响其它帧 */ }
      }
      scheduleIdleShutdown();
      return { ok: true, frames: frames.length, desc: seen.join('\n'), src };
    } catch (e) { lastErr = e; }
  }
  scheduleIdleShutdown();
  return { ok: false, error: '视频地址下载失败（可能需要登录/防盗链）' + (lastErr ? '：' + lastErr.message : '') };
}


/** 页面里的图片地址（按面积排序，去掉小图标）；抖音图文用它拿原图 */
async function imagesFromPage(url, { timeoutMs = 20000, minWidth = 400, limit = 6 } = {}) {
  const { port } = await launchBrowser({ timeoutMs });
  const create = await fetch('http://127.0.0.1:' + port + '/json/new?' + encodeURIComponent(url), { method: 'PUT' });
  if (!create.ok) throw new Error('打开页面失败：HTTP ' + create.status);
  const target = await create.json();
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  const pending = new Map();
  let nextId = 1;
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
    setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error(method + ' 超时')); } }, timeoutMs);
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
          const pp = pending.get(msg.id);
          pending.delete(msg.id);
          if (msg.error) pp.reject(new Error(msg.error.message || 'CDP 错误'));
          else pp.resolve(msg.result);
        }
      } catch { /* ignore */ }
    });
    await send('Page.enable');
    await send('Page.navigate', { url });
    await new Promise((r) => setTimeout(r, 5000));
    // 图文作品常是懒加载：滚几屏把图片催出来，再等一等
    for (let i = 0; i < 6; i += 1) {
      await send('Runtime.evaluate', { expression: 'window.scrollBy(0, Math.round(window.innerHeight * 1.2))' });
      await new Promise((r) => setTimeout(r, 800));
    }
    await new Promise((r) => setTimeout(r, 1500));
    const res = await send('Runtime.evaluate', {
      expression: `(() => {
        const out = [];
        document.querySelectorAll('img').forEach((img) => {
          const src = img.currentSrc || img.src || '';
          const w = Number(img.naturalWidth) || 0;
          const h = Number(img.naturalHeight) || 0;
          if (/^https?:/.test(src) && /douyinDefault|placeholder|avatar/i.test(src) === false && w >= MINW) out.push({ src, w, h });
        });
        return out;
      })()`.replace('MINW', String(minWidth)),
      returnByValue: true,
    });
    const list = (res && res.result && res.result.value) || [];
    list.sort((a, b) => b.w * b.h - a.w * a.h);
    return list.slice(0, limit);
  } finally {
    scheduleIdleShutdown();
    try { ws.close(); } catch { /* ignore */ }
    try { await fetch('http://127.0.0.1:' + port + '/json/close/' + target.id); } catch { /* ignore */ }
  }
}

module.exports = { findBrowser, browserAvailable, renderPage, httpPage, openPage, imagesFromPage, shutdownBrowser, findFfmpeg, videoSource, describeVideo };