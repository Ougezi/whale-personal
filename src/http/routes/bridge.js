'use strict';

const { json, readBody } = require('../util');

module.exports = function register(router) {
  // 桥接心跳：让状态接口知道「桥接在不在、UIA 通不通」。没这个，服务端只能看到
  // 「我收到了消息」，根本不知道回复有没有可能发出去。
  router.post('/api/bridge/heartbeat', async (runtime, req, res) => {
    const hb = await readBody(req);
    const platform = String((hb && hb.platform) || 'wechat').toLowerCase();
    const gw = runtime.gateways.get(platform);
    if (!gw) return json(res, 404, { ok: false, error: `未知平台 ${platform}` });
    if (!gw.verifyToken(req, hb)) return json(res, 403, { ok: false, error: 'token 不对' });
    return json(res, 200, gw.heartbeat(hb));
  });

  // 网关入口：POST /webhook/{platform}（当前只有 wechat）
  router.pattern(/^\/webhook\/([a-zA-Z]+)$/, async (runtime, req, res, info) => {
    const { params, method, url } = info;
    const platform = params[0].toLowerCase();
    const gateway = runtime.gateways.get(platform);
    if (!gateway) return json(res, 404, { ok: false, error: `未知平台 ${platform}` });

    if (method === 'GET') {
      if (!gateway.verifyToken(req, null)) return json(res, 403, { ok: false, error: 'token 不对' });
      const challenge = url.searchParams.get('challenge') || url.searchParams.get('echostr');
      if (challenge) {
        res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
        return res.end(challenge);
      }
      return json(res, 200, gateway.status());
    }
    if (method !== 'POST') return json(res, 405, { ok: false, error: 'method not allowed' });

    const body = await readBody(req);
    if (!gateway.verifyToken(req, body)) {
      runtime.logger.warn(`[${platform}] webhook token 校验失败`);
      return json(res, 403, { ok: false, error: 'token 不对' });
    }
    if (!gateway.options.enabled) {
      return json(res, 200, { ok: true, skipped: 'adapter_disabled' });
    }
    // 本地桥接会带 x-whale-bridge: 1（或 body.local=true）。它靠 HTTP 响应拿回复，
    // 所以「没配 outboundUrl」对它是正常的，不该按「发不出去」报警。
    const isLocalBridge = String(req.headers['x-whale-bridge'] || '') === '1' || Boolean(body && body.local);
    const result = await gateway.handleInbound(body, { local: isLocalBridge });
    return json(res, 200, result);
  });

  // I-17：桥接发送回执 → receipts.js 账本（只读统计 + 落内存）
  router.post('/api/bridge/receipt', async (runtime, req, res) => {
    const body = await readBody(req);
    const gw = runtime.gateways.get('wechat');
    if (!gw || !gw.verifyToken(req, body)) return json(res, 403, { ok: false, error: 'token 不对' });
    if (!runtime.receiptLedger) return json(res, 503, { ok: false, error: 'receipt ledger not ready' });
    const r = runtime.receiptLedger.ingest(body);
    return json(res, r.ok ? 200 : 400, r);
  });

  router.get('/api/bridge/receipts', async (runtime, req, res) => {
    if (!runtime.receiptLedger) return json(res, 503, { ok: false, error: 'receipt ledger not ready' });
    return json(res, 200, { ok: true, stats: runtime.receiptLedger.stats(), last: runtime.receiptLedger.last(20) });
  });

  // I-16：委托生命周期 → action-core/job.js
  router.post('/api/actions/jobs', async (runtime, req, res) => {
    const body = await readBody(req);
    const gw = runtime.gateways.get('wechat');
    if (!gw || !gw.verifyToken(req, body)) return json(res, 403, { ok: false, error: 'token 不对' });
    if (!runtime.actionJobs) return json(res, 503, { ok: false, error: 'action jobs not ready' });
    const r = runtime.actionJobs.apply(body);
    return json(res, r.ok ? 200 : 400, r);
  });

  // I-21：只读 ActionSpec 目录；不替代 Python action_guard 的执行策略
  router.get('/api/actions/registry', async (runtime, req, res) => {
    const { catalog } = require('../../services/actionRegistry');
    return json(res, 200, { ok: true, actions: catalog() });
  });

  router.post('/api/actions/validate', async (runtime, req, res) => {
    const body = await readBody(req);
    const gw = runtime.gateways.get('wechat');
    if (!gw || !gw.verifyToken(req, body)) return json(res, 403, { ok: false, error: 'token 不对' });
    const { validate } = require('../../services/actionRegistry');
    return json(res, 200, validate(body.action, body.args || {}));
  });

  // I-22：迁移 dry-run（只读预览，不写目标）
  router.post('/api/memory/migrate-preview', async (runtime, req, res) => {
    const body = await readBody(req);
    const gw = runtime.gateways.get('wechat');
    if (!gw || !gw.verifyToken(req, body)) return json(res, 403, { ok: false, error: 'token 不对' });
    const { preview } = require('../../services/migrationPreview');
    const r = preview(body);
    return json(res, r.ok ? 200 : 400, r);
  });
};
