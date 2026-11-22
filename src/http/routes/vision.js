'use strict';

const vision = require('../../adapters/vision');
const { errorMessage } = require('../../infra/errors');
const { json, readBody } = require('../util');
const { safeEqual } = require('../security');

/** /api/vision 也校验 x-bot-token（桥接会带；本机其它程序没有钥匙就调不动） */
function visionAuthorized(runtime, req, body) {
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
  // 「测试看图」：拿内置的 64x64 PNG 试一下 Key 通不通。
  // body.apiKey 可选 —— 可以先测再保存。
  router.post('/api/vision/test', async (runtime, req, res) => {
    let vbody = {};
    try { vbody = await readBody(req); } catch { vbody = {}; }
    if (!visionAuthorized(runtime, req, vbody)) {
      return json(res, 401, { ok: false, error: '看图接口需要 x-bot-token（桥接会自动带；本机其它程序没有钥匙调不动）' });
    }
    const override = vbody && typeof vbody.apiKey === 'string' ? vbody.apiKey.trim() : '';
    const cfg = override
      ? { ...runtime.config, vision: { ...(runtime.config.vision || {}), apiKey: override } }
      : runtime.config;
    try {
      const text = await vision.describe(cfg, {
        imageBase64: vision.TEST_IMAGE,
        mime: 'image/png',
        prompt: '这张图是什么颜色？只回答颜色。',
      });
      return json(res, 200, { ok: true, sample: String(text || '').slice(0, 60), vision: vision.status(runtime.config) });
    } catch (err) {
      return json(res, 500, { ok: false, error: errorMessage(err), vision: vision.status(runtime.config) });
    }
  });

  router.post('/api/vision', async (runtime, req, res) => {
    try {
      const body = await readBody(req, 12 * 1024 * 1024);
      if (!visionAuthorized(runtime, req, body)) {
        return json(res, 401, { ok: false, error: '看图接口需要 x-bot-token（桥接会自动带；本机其它程序没有钥匙调不动）' });
      }
      const text = await vision.describe(runtime.config, {
        imageBase64: body && body.image,
        mime: (body && body.mime) || 'image/jpeg',
        prompt: (body && body.prompt) || '',
      });
      return json(res, 200, { ok: true, text });
    } catch (err) {
      runtime.logger.warn('图片识别失败：' + (err && err.message));
      return json(res, err.statusCode || 500, { ok: false, error: errorMessage(err) });
    }
  });
};
