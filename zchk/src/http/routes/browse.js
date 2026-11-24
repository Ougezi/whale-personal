'use strict';

/**
 * 自主上网的接口 + 一个给人点的小页面。
 *
 * 启动器是预编译的 exe，改不了它的界面，所以把「现在去看看」做成内核自己提供的页面：
 * 打开 http://127.0.0.1:8787/browse 就能看今天看了几条、点一下让她现在去看一条。
 *
 * 注意安全策略：内核统一发 CSP `default-src 'self'; script-src 'self'; style-src 'self'`，
 * **内联 <script>/<style> 会被浏览器直接拦掉**（第一版就是这样静默失效的：页面能显示
 * 但数字全是「-」，因为 refresh 压根没被定义）。所以这里把 JS / CSS 拆成同源的
 * 独立资源提供，不改任何一条安全头。
 */

const { json, readBody } = require('../util');
const { browseSettings, loadState } = require('../../services/browse');
const { describeError } = require('../../infra/errors');

const PAGE = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>鲸鲸 · 自主上网</title>
<link rel="stylesheet" href="/browse.css">
</head>
<body>
  <h1>自主上网</h1>
  <div class="muted">她隔几小时自己刷一条热榜，用自己的话说一句，再影响情绪和念头。</div>

  <div class="card">
    <div class="row">
      <div><div class="muted">今天</div><div><span class="k" id="count">-</span> / <span id="max">-</span> 次</div></div>
      <div><div class="muted">上次</div><div id="last">-</div></div>
      <div><div class="muted">节奏</div><div>每 <span id="interval">-</span> 分钟</div></div>
      <div><div class="muted">看过</div><div><span id="seen">-</span> 条</div></div>
    </div>
  </div>

  <p><button id="go">现在去看看</button> <span class="muted" id="tip"></span></p>
  <pre id="out" hidden></pre>

<script src="/browse.js" defer></script>
</body>
</html>`;

const CSS = `:root { color-scheme: light dark; }
body { font: 15px/1.6 system-ui, "Microsoft YaHei", sans-serif; max-width: 640px; margin: 40px auto; padding: 0 18px; }
h1 { font-size: 20px; margin: 0 0 4px; }
.muted { opacity: .65; font-size: 13px; }
.card { border: 1px solid rgba(128,128,128,.35); border-radius: 12px; padding: 16px; margin: 18px 0; }
button { font: inherit; padding: 9px 18px; border-radius: 10px; border: 1px solid rgba(128,128,128,.45); background: rgba(120,140,255,.12); cursor: pointer; }
button:disabled { opacity: .5; cursor: default; }
.row { display: flex; gap: 18px; flex-wrap: wrap; }
.k { font-weight: 600; }
pre { white-space: pre-wrap; word-break: break-word; background: rgba(128,128,128,.08); padding: 12px; border-radius: 10px; }
`;

const JS = `function formatApplied(a) {
  if (!a) return '（没有写回）';
  const parts = [];
  Object.keys(a.emotions || {}).forEach(function (k) { parts.push(k + ' +' + a.emotions[k]); });
  Object.keys(a.wants || {}).forEach(function (k) { parts.push(k + ' +' + a.wants[k]); });
  return parts.length ? parts.join(' · ') : '（没有变化）';
}

async function refresh() {
  const r = await fetch('/api/browse/status').then(function (x) { return x.json(); }).catch(function () { return null; });
  if (!r || !r.ok) { document.getElementById('tip').textContent = '内核没应答'; return; }
  document.getElementById('count').textContent = r.today && r.today.count != null ? r.today.count : 0;
  document.getElementById('max').textContent = r.settings ? r.settings.maxPerDay : '-';
  document.getElementById('interval').textContent = r.settings ? r.settings.intervalMin : '-';
  document.getElementById('seen').textContent = r.seen == null ? '-' : r.seen;
  document.getElementById('last').textContent = r.lastTs ? new Date(r.lastTs).toLocaleTimeString() : '还没看过';
  document.getElementById('tip').textContent = r.enabled ? '' : '（自主上网没启动）';
}

async function go() {
  const btn = document.getElementById('go');
  const out = document.getElementById('out');
  btn.disabled = true;
  out.hidden = false;
  out.textContent = '正在挑一条…';
  try {
    const res = await fetch('/api/browse/once', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ force: 1 }),
    }).then(function (x) { return x.json(); });
    if (!res || !res.ok) {
      out.textContent = '这次没看成：' + ((res && res.reason) || '未知原因');
    } else {
      out.textContent = [
        '来源：' + res.source,
        '看到：' + res.title,
        '她说：' + res.reaction,
        '写回：' + formatApplied(res.applied),
      ].join('\\n');
    }
  } catch (e) {
    out.textContent = '请求失败：' + e;
  } finally {
    btn.disabled = false;
    refresh();
  }
}

document.getElementById('go').addEventListener('click', go);
refresh();
setInterval(refresh, 30000);
`;

function send(res, type, body) {
  res.writeHead(200, {
    'Content-Type': type,
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

module.exports = function register(router) {
  router.get('/browse', (runtime, req, res) => send(res, 'text/html; charset=utf-8', PAGE));
  router.get('/browse.css', (runtime, req, res) => send(res, 'text/css; charset=utf-8', CSS));
  router.get('/browse.js', (runtime, req, res) => send(res, 'text/javascript; charset=utf-8', JS));

  router.get('/api/browse/status', (runtime, req, res) => {
    const svc = runtime.browse || null;
    const cfg = browseSettings(runtime.config);
    const dir = (runtime.config.paths && runtime.config.paths.dataDir) || '';
    const state = dir ? loadState(dir) : { day: '', count: 0, lastTs: 0, seen: [] };
    return json(res, 200, {
      ok: true,
      enabled: Boolean(svc),
      settings: cfg,
      today: { day: state.day, count: state.count },
      lastTs: state.lastTs || 0,
      seen: (state.seen || []).length,
    });
  });

  router.post('/api/browse/once', async (runtime, req, res) => {
    if (!runtime.browse) return json(res, 503, { ok: false, error: '自主上网没有启动' });
    let body = {};
    try {
      body = (await readBody(req)) || {};
    } catch (err) {
      body = {};
    }
    const force = body.force === true || body.force === 1 || body.force === '1';
    try {
      const out = await runtime.browse.tick({ force });
      return json(res, 200, out);
    } catch (err) {
      runtime.logger?.warn?.('自主上网（手动）失败：' + describeError(err));
      return json(res, 500, { ok: false, error: describeError(err) });
    }
  });
};
