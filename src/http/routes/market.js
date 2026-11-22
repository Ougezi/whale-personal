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
const opsGate = require('../../services/opsGate');
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
        id: 'douyin-watch', name: '刷抖音（观看/日报）', icon: '抖', category: '抖音', version: '0.4.0', status: douyinOk ? 'ready' : 'missing',
        desc: '推荐流卡片、每日额度、兴趣衰减、日报；她的抖音 sidecar 提供。',
        intro: '这是鲸鲸「像人一样刷抖音」的那一层：按每日额度读推荐流卡片、记兴趣（会随时间衰减）、写日报；需要真看画面时可以抓帧。数据都落在她自己的数据目录，登录态用独立的 Chrome/Edge profile。',
        highlights: ['额度 / 冷却 / 时段四道闸门，不会偷偷刷一整天', '兴趣按遗忘曲线衰减，热点不会被永久高估', 'cards 模式 0 模型调用；play 模式每帧 1 次预算', '写操作（点赞/收藏）默认关，单独开关'],
        panels: [
          { id: 'watch', title: '刷一轮推荐流', desc: '按每日额度读一轮卡片，0 模型调用', kind: 'douyin', op: 'watch', args: { cards: 6 } },
          { id: 'hot', title: '热榜', desc: '匿名可用，自动翻页', kind: 'douyin', op: 'hot', args: { limit: 10 } },
          { id: 'report', title: '今天的日报', desc: '今天看了什么、兴趣变化', kind: 'douyin', op: 'report', args: {} },
          { id: 'login', title: '抖音登录状态', desc: '看浏览器通道是否已登录', kind: 'douyin', op: 'link', args: { url: '' } },
          { id: 'accounts', title: '浏览器通道', desc: 'Chrome / Edge 各自 profile', kind: 'douyin', op: 'accounts', args: { action: 'list' } }
        ]
      },
      {
        id: 'douyin-kb', name: '抖音知识库（下载/主页/评论）', icon: '库', category: '抖音', category: '抖音', version: '0.4.0', status: douyinOk ? 'ready' : 'missing',
        desc: '下载原文件、作者主页、合集、评论、搜用户、导出、SQLite 索引、批量。',
        panels: [
          { id: 'download', title: '下载一条作品', desc: '视频/图文原图/音频/封面，落盘去重', kind: 'douyin', op: 'download', args: { modalId: '' }, input: { field: 'modalId', hint: 'id / 链接 / 短链' } },
          { id: 'user', title: '读作者主页', desc: '发布/喜欢/收藏/合集列表', kind: 'douyin', op: 'user', args: { user: '', limit: 20 }, input: { field: 'user', hint: '主页链接 / sec_uid' } },
          { id: 'comments', title: '读评论', desc: '还支持 sort / replies / cursor', kind: 'douyin', op: 'comments', args: { modalId: '', limit: 20 }, input: { field: 'modalId', hint: '视频 id / 链接' } },
          { id: 'export', title: '导出知识库', desc: 'JSON / CSV 落盘', kind: 'douyin', op: 'export', args: { format: 'json' } },
          { id: 'index', title: 'SQLite 索引', desc: 'node:sqlite 检索', kind: 'douyin', op: 'index', args: {} }
        ]
      },
      {
        id: 'fetch', name: '网页抓取', icon: '网', category: '抓取', category: '网络', version: '4.7', status: 'ready',
        desc: '直连抓正文，打不开用本机浏览器渲染；统计落 data/fetch-stats.jsonl。',
        panels: [
          { id: 'browser', title: '浏览器状态', desc: 'CDP 是否可用', kind: 'http', method: 'GET', path: '/api/fetch/browser' },
          { id: 'fetch', title: '抓一个网页', desc: '直连失败自动用浏览器渲染', kind: 'http', method: 'POST', path: '/api/fetch', body: { url: '' }, input: { field: 'url', hint: 'https://…' } }
        ]
      },
      {
        id: 'vision', name: '看图 / 文字识别', icon: '眼', category: '理解', category: '图像', version: '4.7', status: 'ready',
        desc: '视觉模型优先，没配 Key 自动退本机 Windows OCR。',
        panels: [
          { id: 'stats', title: '看图的两种模式', kind: 'info', text: '聊天里发图会自动识别；本机 OCR 是兜底，不需要额外 Key。' }
        ]
      },
      {
        id: 'search-image', name: '搜图（表情/网图）', icon: '搜', category: '图像', version: '4.7', status: 'bridge',
        desc: '由桥接处理：她在聊天里写 [[pic:关键词]] 或你让她「搜一张…」。下载的图进 data/stickers/搜来的（已从表情分类里隐藏）。',
        intro: '桥接侧的搜图能力：你让她「搜一张…」时她去网上找图；这些网图不会混进她自己的表情分类（「搜来的」已被隐藏），避免她把拼图当表情发。',
        highlights: ['搜图结果只落盘，不当表情发', '自有表情库才是她发图的来源', '需要你明确说「搜一张」才走这条路'],
        panels: [{ id: 'how', title: '怎么用', kind: 'info', text: '在微信里说「搜一张…」或让她写 [[pic:关键词]]；下载的图不会当表情发出去。' }]
      },
      {
        id: 'delegation', name: '委托执行（DSH）', icon: '手', category: '工具', version: '4.7', status: 'ready',
        desc: '她写 [[dsh:任务]] 把动手活交给 DSH 执行端；本机有每日上限与超时。',
        intro: '把「动手」类活（改文件、跑命令、查资料）交给 DSH 执行端：默认只读，明确要改文件才升级到可写；有并发、每日上限与超时，失败会给她可读的事实。',
        highlights: ['默认只读，写文件才提权', '超时清理整棵进程树', '能力闸门：发微信/截图这类提前拒绝'],
        panels: [{ id: 'how', title: '怎么用', kind: 'info', text: '在微信里说「动手：…」；只读任务默认，改文件才会升级权限。' }]
      },
      {
        id: 'toolbox', name: '自检 / 状态', icon: '检', category: '系统', category: '系统', version: '4.7', status: 'ready',
        desc: '内核与桥接的当前状态、健康自查。',
        panels: [{ id: 'status', title: '内核状态', kind: 'http', method: 'GET', path: '/api/status' }]
      }
    ]
  };
}

/** 插件市场排序/置顶：落 data/plugin-market-order.json，UI 按它渲染 */
function orderFile(runtime) {
  const dataDir = (runtime.config.paths && runtime.config.paths.dataDir) || path.join(process.cwd(), 'data');
  return path.join(dataDir, 'plugin-market-order.json');
}

function readOrder(runtime) {
  try {
    const j = JSON.parse(fs.readFileSync(orderFile(runtime), 'utf8'));
    return { order: Array.isArray(j.order) ? j.order.map(String) : [], pinned: Array.isArray(j.pinned) ? j.pinned.map(String) : [] };
  } catch {
    return { order: [], pinned: [] };
  }
}

function saveOrder(runtime, next) {
  const file = orderFile(runtime);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(next, null, 1), 'utf8');
  fs.renameSync(tmp, file);
  return next;
}

module.exports = function register(router) {
  router.get('/api/market/plugins', async (runtime, req, res) => {
    return json(res, 200, pluginCatalog(runtime));
  });

  // 排序 / 置顶
  router.get('/api/market/order', async (runtime, req, res) => {
    return json(res, 200, { ok: true, ...readOrder(runtime) });
  });

  router.post('/api/market/order', async (runtime, req, res) => {
    let body = {};
    try { body = await readBody(req, 64 * 1024); } catch { body = {}; }
    if (!authorized(runtime, req, body)) return json(res, 401, { ok: false, error: '需要 x-bot-token' });
    const cur = readOrder(runtime);
    const ids = pluginCatalog(runtime).plugins.map((p) => p.id);
    const clean = (list) => (Array.isArray(list) ? list.map(String).filter((id) => ids.includes(id)) : []);
    const next = {
      order: body.order == null ? cur.order : clean(body.order),
      pinned: body.pinned == null ? cur.pinned : [...new Set(clean(body.pinned))],
    };
    return json(res, 200, { ok: true, ...saveOrder(runtime, next) });
  });

  // 写操作开关（默认关；面板上的开关改这里，sidecar 下次启动按它注册 ops_*）
  router.get('/api/market/ops', async (runtime, req, res) => {
    return json(res, 200, { ok: true, ...readOps(), file: opsFile() });
  });

  router.post('/api/market/ops', async (runtime, req, res) => {
    let body = {};
    try { body = await readBody(req, 64 * 1024); } catch { body = {}; }
    if (!authorized(runtime, req, body)) return json(res, 401, { ok: false, error: '需要 x-bot-token' });
    const next = opsGate.write({
      enableOps: body.enableOps == null ? undefined : Boolean(body.enableOps),
      allowLike: body.allowLike == null ? undefined : Boolean(body.allowLike),
      allowCollect: body.allowCollect == null ? undefined : Boolean(body.allowCollect),
      dailyWriteActions: body.dailyWriteActions == null ? undefined : body.dailyWriteActions,
    });
    return json(res, 200, { ok: true, ...next, file: opsGate.opsFile() });
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
