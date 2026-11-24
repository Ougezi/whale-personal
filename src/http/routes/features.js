'use strict';

const features = require('../../infra/features');
const { applyConfigPatch } = require('../../infra/configPatch');
const { prepareFeatureCommand } = require('../../services/configCommands');
const { json, readBody } = require('../util');

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
};
