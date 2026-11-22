'use strict';

/**
 * 插件市场 / 面板 API（本机 GUI 用）。
 *
 *  - GET  /api/market/plugins   列出现在「已经装到她身上」的插件与各自面板
 *  - POST /api/douyin/run       面板点按钮 → 调抖音 sidecar 的 op（watch/hot/download/user/...）
 *
 * 面板只做「她本来就有的能力」的入口，不新增权限：写操作（点赞/收藏）走 sidecar 自己的
 * enableOps 门控，默认仍然关着。
 */

const douyinSidecar = require('../../adapters/douyinSidecar');
const { json, readBody } = require('../util');
const { safeEqual } = require('../security');
const path = require('node:path');
const fs = require('node:fs');

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

function pluginCatalog(runtime) {
  const dataDir = (runtime.config.paths && runtime.config.paths.dataDir) || path.join(process.cwd(), 'data');
  const has = (rel) => fs.existsSync(path.join(dataDir, rel));
  const douyinOk = douyinSidecar.available();
  return {
    ok: true,
    dataDir,
    plugins: [
      {
        id: 'douyin-watch', name: '刷抖音（观看/日报）', version: '0.4.0', status: douyinOk ? 'ready' : 'missing',
        desc: '推荐流卡片、每日额度、兴趣衰减、日报；她的抖音 sidecar 提供。',
        panels: [
          { id: 'watch', title: '刷一轮推荐流', kind: 'douyin', op: 'watch', args: { cards: 6 } },
          { id: 'hot', title: '热榜', kind: 'douyin', op: 'hot', args: { limit: 10 } },
          { id: 'report', title: '今天的日报', kind: 'douyin', op: 'report', args: {} },
          { id: 'login', title: '抖音登录状态', kind: 'douyin', op: 'link', args: { url: '' } },
          { id: 'accounts', title: '浏览器通道', kind: 'douyin', op: 'accounts', args: { action: 'list' } }
        ]
      },
      {
        id: 'douyin-kb', name: '抖音知识库（下载/主页/评论）', version: '0.4.0', status: douyinOk ? 'ready' : 'missing',
        desc: '下载原文件、作者主页、合集、评论、搜用户、导出、SQLite 索引、批量。',
        panels: [
          { id: 'download', title: '下载一条作品', kind: 'douyin', op: 'download', args: { modalId: '' }, input: { field: 'modalId', hint: 'id / 链接 / 短链' } },
          { id: 'user', title: '读作者主页', kind: 'douyin', op: 'user', args: { user: '', limit: 20 }, input: { field: 'user', hint: '主页链接 / sec_uid' } },
          { id: 'comments', title: '读评论', kind: 'douyin', op: 'comments', args: { modalId: '', limit: 20 }, input: { field: 'modalId', hint: '视频 id / 链接' } },
          { id: 'export', title: '导出知识库', kind: 'douyin', op: 'export', args: { format: 'json' } },
          { id: 'index', title: 'SQLite 索引', kind: 'douyin', op: 'index', args: {} }
        ]
      },
      {
        id: 'fetch', name: '网页抓取', version: '4.6', status: 'ready',
        desc: '直连抓正文，打不开用本机浏览器渲染；统计落 data/fetch-stats.jsonl。',
        panels: [
          { id: 'browser', title: '浏览器状态', kind: 'http', method: 'GET', path: '/api/fetch/browser' },
          { id: 'fetch', title: '抓一个网页', kind: 'http', method: 'POST', path: '/api/fetch', body: { url: '' }, input: { field: 'url', hint: 'https://…' } }
        ]
      },
      {
        id: 'vision', name: '看图 / 文字识别', version: '4.6', status: 'ready',
        desc: '视觉模型优先，没配 Key 自动退本机 Windows OCR。',
        panels: [
          { id: 'stats', title: '看图的两种模式', kind: 'info', text: '聊天里发图会自动识别；本机 OCR 是兜底，不需要额外 Key。' }
        ]
      },
      {
        id: 'search-image', name: '搜图（表情/网图）', version: '4.6', status: 'bridge',
        desc: '由桥接处理：她在聊天里写 [[pic:关键词]] 或你让她「搜一张…」。下载的图进 data/stickers/搜来的（已从表情分类里隐藏）。',
        panels: [{ id: 'how', title: '怎么用', kind: 'info', text: '在微信里说「搜一张…」或让她写 [[pic:关键词]]；下载的图不会当表情发出去。' }]
      },
      {
        id: 'delegation', name: '委托执行（DSH）', version: '4.6', status: 'ready',
        desc: '她写 [[dsh:任务]] 把动手活交给 DSH 执行端；本机有每日上限与超时。',
        panels: [{ id: 'how', title: '怎么用', kind: 'info', text: '在微信里说「动手：…」；只读任务默认，改文件才会升级权限。' }]
      },
      {
        id: 'toolbox', name: '自检 / 状态', version: '4.6', status: 'ready',
        desc: '内核与桥接的当前状态、健康自查。',
        panels: [{ id: 'status', title: '内核状态', kind: 'http', method: 'GET', path: '/api/status' }]
      }
    ]
  };
}

module.exports = function register(router) {
  router.get('/api/market/plugins', async (runtime, req, res) => {
    return json(res, 200, pluginCatalog(runtime));
  });

  router.post('/api/douyin/run', async (runtime, req, res) => {
    let body = {};
    try { body = await readBody(req, 256 * 1024); } catch { body = {}; }
    if (!authorized(runtime, req, body)) return json(res, 401, { ok: false, error: '需要 x-bot-token' });
    const op = String(body.op || '').trim();
    const args = body.args && typeof body.args === 'object' ? body.args : {};
    if (!op) return json(res, 400, { ok: false, error: '缺少 op' });
    try {
      const out = await douyinSidecar.run(op, args);
      return json(res, 200, out);
    } catch (err) {
      return json(res, 500, { ok: false, error: String(err && err.message || err) });
    }
  });
};
