'use strict';

const features = require('../../infra/features');
const { applyConfigPatch } = require('../../infra/configPatch');
const { prepareFeatureCommand } = require('../../services/configCommands');
const { json, readBody } = require('../util');
const hobby = require('../../services/hobby');

module.exports = function register(router) {
  // ---- 功能开关（POST /api/features 可开关；关掉就回到旧行为）----
  router.get('/api/features', (runtime, req, res) => {
    return json(res, 200, { ok: true, features: features.list(runtime.config) });
  });

  router.post('/api/features', async (runtime, req, res) => {
    const body = await readBody(req);
    try {
      const { key, entry, value, patch } = prepareFeatureCommand(body);
      applyConfigPatch(runtime, patch);
      runtime.logger.info(`功能开关 ${entry.label} → ${value ? '开' : '关'}`);
      return json(res, 200, { ok: true, key, value, features: features.list(runtime.config) });
    } catch (err) {
      return json(res, 400, { ok: false, error: err.message });
    }
  });

  // I-26：affectCore 的 chat 白名单（空 = 不生效）
  router.post('/api/affect-core/chats', async (runtime, req, res) => {
    const body = await readBody(req);
    const chats = Array.isArray(body.chats) ? body.chats.map(String).filter(Boolean).slice(0, 50) : [];
    try {
      applyConfigPatch(runtime, { 'affectCore.chats': chats });
      return json(res, 200, { ok: true, chats });
    } catch (err) {
      return json(res, 400, { ok: false, error: err.message });
    }
  });

  router.get('/api/affect-core/status', async (runtime, req, res) => {
    const chat = new URL(req.url, 'http://localhost').searchParams.get('chat') || '';
    const { status } = require('../../services/affectCore');
    return json(res, 200, { ok: true, chat, last: status(chat) });
  });

  router.post('/api/expression-core/chats', async (runtime, req, res) => {
    const body = await readBody(req);
    const chats = Array.isArray(body.chats) ? body.chats.map(String).filter(Boolean).slice(0, 50) : [];
    try {
      applyConfigPatch(runtime, { 'expressionCore.chats': chats });
      return json(res, 200, { ok: true, chats });
    } catch (err) {
      return json(res, 400, { ok: false, error: err.message });
    }
  });

  router.post('/api/scope-shadow/chats', async (runtime, req, res) => {
    const body = await readBody(req);
    const chats = Array.isArray(body.chats) ? body.chats.map(String).filter(Boolean).slice(0, 50) : [];
    try {
      applyConfigPatch(runtime, { 'scopeShadow.chats': chats });
      return json(res, 200, { ok: true, chats });
    } catch (err) {
      return json(res, 400, { ok: false, error: err.message });
    }
  });

  router.post('/api/scope-core/chats', async (runtime, req, res) => {
    const body = await readBody(req);
    const chats = Array.isArray(body.chats) ? body.chats.map(String).filter(Boolean).slice(0, 50) : [];
    try {
      applyConfigPatch(runtime, { 'scopeCore.chats': chats });
      return json(res, 200, { ok: true, chats });
    } catch (err) {
      return json(res, 400, { ok: false, error: err.message });
    }
  });

  router.get('/api/hobbies', (runtime, req, res) => {
    const st = hobby.status(runtime.config);
    return json(res, 200, { ok: true, enabled: features.isOn(runtime.config, 'hobbies'), ...st });
  });

  // 兴趣白名单：空名单不生效
  router.post('/api/hobbies/chats', async (runtime, req, res) => {
    const body = await readBody(req);
    const chats = Array.isArray(body.chats) ? body.chats.map(String).filter(Boolean).slice(0, 50) : [];
    try {
      applyConfigPatch(runtime, { 'hobbies.chats': chats });
      return json(res, 200, { ok: true, chats });
    } catch (err) {
      return json(res, 400, { ok: false, error: err.message });
    }
  });

  // 平台只读结果写兴趣证据；hobbies=false 时不收
  router.post('/api/hobbies/observe', async (runtime, req, res) => {
    if (!features.isOn(runtime.config, 'hobbies')) return json(res, 403, { ok: false, error: 'hobbies disabled' });
    const body = await readBody(req);
    const text = String(body?.text || '').slice(0, 1000);
    const ref = String(body?.ref || '').slice(0, 300);
    if (!text || !ref) return json(res, 400, { ok: false, error: 'text/ref required' });
    try {
      const out = hobby.recordText(runtime.config, {
        text, role: 'platform', kind: String(body?.kind || 'platform-read'),
        weight: Math.max(1, Math.min(5, Number(body?.weight) || 1)), ref,
      });
      return json(res, 200, out);
    } catch (err) {
      return json(res, 400, { ok: false, error: err.message });
    }
  });
};
