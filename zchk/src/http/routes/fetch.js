'use strict';

const browser = require('../../adapters/browser');
const { errorMessage } = require('../../infra/errors');
const { json, readBody } = require('../util');
const { safeEqual } = require('../security');
const fs = require('node:fs');
const path = require('node:path');

/** 每次抓取的统计：url / 方式 / 字数 / 耗时，追加到 data/fetch-stats.jsonl */
function recordStats(runtime, entry) {
  try {
    const dir = (runtime.config.paths && runtime.config.paths.dataDir) || path.join(process.cwd(), 'data');
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(path.join(dir, 'fetch-stats.jsonl'), JSON.stringify(entry) + '\n', 'utf8');
  } catch { /* 统计写不进去不影响抓取 */ }
}

function authorized(runtime, req, body) {
  const token = String(((runtime.config.gateway || {}).wechat || {}).inboundToken || '').trim();
  if (!token) return false;
  const header = String(req.headers['x-bot-token'] || '').trim();
  const query = req.url && req.url.includes('token=')
    ? String(new URL(req.url, 'http://localhost').searchParams.get('token') || '').trim()
    : '';
  const fromBody = body && typeof body.token === 'string' ? body.token.trim() : '';
  return [header, query, fromBody].some((candidate) => candidate && safeEqual(String(candidate), token));
}

module.exports = function register(router) {
  // 打开一个网页：先 HTTP 直连，正文太少再用本机浏览器渲染
  router.post('/api/fetch', async (runtime, req, res) => {
    let body = {};
    try { body = await readBody(req, 1024 * 1024); } catch { body = {}; }
    if (!authorized(runtime, req, body)) {
      return json(res, 401, { ok: false, error: '抓网页需要 x-bot-token（桥接会自动带；本机其它程序没有钥匙调不动）' });
    }
    const url = String((body && body.url) || '').trim();
    if (!url) return json(res, 400, { ok: false, error: '缺少 url' });
    const prefer = body && body.mode === 'browser' ? 'browser' : 'auto';
    try {
      const page = await browser.openPage(url, { prefer, timeoutMs: 15000 });
      recordStats(runtime, {
        at: new Date().toISOString(), url: url.slice(0, 500), method: page.method,
        ok: Boolean(page.ok), chars: (page.text || '').length, ms: page.ms || 0, title: (page.title || '').slice(0, 120),
      });
      runtime.logger.info('[fetch] ' + page.method + ' ' + (page.ok ? 'ok' : 'fail') + ' ' + url.slice(0, 120) + ' chars=' + (page.text || '').length + ' ms=' + (page.ms || 0));
      return json(res, 200, {
        ok: Boolean(page.ok),
        url: page.url || url,
        method: page.method,
        title: page.title || '',
        text: page.text || '',
        error: page.error || '',
        ms: page.ms || 0,
      });
    } catch (err) {
      return json(res, 500, { ok: false, error: errorMessage(err) });
    }
  });

  router.get('/api/fetch/browser', async (runtime, req, res) => {
    return json(res, 200, { ok: true, browser: browser.findBrowser(), available: browser.browserAvailable() });
  });
};