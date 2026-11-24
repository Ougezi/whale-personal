'use strict';

const path = require('node:path');
const { json, readBody } = require('../util');
const { isLoopbackRequest } = require('../security');
const migrate = require('../../memory/migrate');
const { describeError, errorMessage } = require('../../infra/errors');

/**
 * 旧版（3.x）记忆的检测 / 转换。
 *
 * 启动时 Store 构造已经会自动迁移；这里额外提供：
 *   GET  /api/memory/import/status   只读检测：有没有旧格式、会补多少（dry-run）
 *   GET  /api/memory/import/notice   启动器用：有没有「刚导入完、还没提示过」的报告
 *   POST /api/memory/import/ack      提示展示完，标记已读（幂等）
 *   POST /api/memory/import          手动执行转换（幂等：签名已记录就什么都不做）
 *
 * 不提供任何记忆正文；只回计数。只允许本机调用。
 */

let running = false;

function memoryDirOf(runtime) {
  return path.join(runtime.config.paths.dataDir, 'memory');
}

module.exports = function register(router) {
  // 记忆审计（S3）：只读，仅本机
  router.get('/api/memory/audit', (runtime, req, res) => {
    if (!isLoopbackRequest(req)) return json(res, 403, { ok: false, error: '仅允许本机调用' });
    let limit = 50;
    try {
      const u = new URL(req.url, 'http://localhost');
      limit = Number(u.searchParams.get('limit')) || 50;
    } catch { /* 参数坏了用默认 */ }
    const audit = require('../../memory/audit');
    return json(res, 200, { ok: true, items: audit.recent(runtime.config.paths.dataDir, limit) });
  });

  // 记忆重载：外部脚本改了磁盘记忆后不用重启内核（2026-11 架构审查）
  router.post('/api/memory/reload', (runtime, req, res) => {
    if (!isLoopbackRequest(req)) return json(res, 403, { ok: false, error: '仅允许本机调用' });
    try {
      runtime.store.chatStore.load();
      const chats = [...runtime.store.chatStore.chats.values()];
      return json(res, 200, { ok: true, chats: chats.length,
        messages: chats.reduce((n, c) => n + ((c.messages || []).length), 0) });
    } catch (err) {
      return json(res, 500, { ok: false, error: describeError(err) });
    }
  });


  /**
   * POST /api/memory/note  { chat, uid, text, kind?, confidence? }
   *
   * 桥接用它把**真实发生过的事**写进记忆（例如"图发出去了"），
   * 这样她的自述有事实依据，不用靠猜——猜错的话又会被摘进记忆，越滚越歪。
   * 只允许本机调用；只写偏好/事实，不碰原文消息。
   */
  router.post('/api/memory/note', (runtime, req, res) => {
    if (!isLoopbackRequest(req)) return json(res, 403, { ok: false, error: '记忆写入只允许在本机操作' });
    return (async () => {
      try {
        const body = await readBody(req);
        const chat = String((body && body.chat) || '').trim();
        const uid = String((body && body.uid) || '').trim();
        const note = String((body && body.text) || '').trim();
        if (!chat || !uid || !note) return json(res, 400, { ok: false, error: 'chat / uid / text 都不能为空' });
        // 必须先确认这个会话真的存在：addNote → ensureChat 会给不存在的 id 凭空建一个会话
        // （2026-11-21 自测时写了个假 wxid，库存里多出一个幽灵会话）
        const chats = runtime.store.chatStore.chats;
        if (!chats || typeof chats.get !== 'function' || !chats.get(chat)) {
          return json(res, 404, { ok: false, error: '会话不存在，拒绝写入（避免凭空建会话）' });
        }
        const kind = ['fact', 'preference', 'promise', 'recent', 'taboo'].includes(body.kind) ? body.kind : 'recent';
        const confidence = Number.isFinite(Number(body.confidence)) ? Number(body.confidence) : 0.9;
        const active = runtime.store.addNote(chat, uid, { text: note, key: String(body.key || '') , kind }, {
          confidence,
          source: 'bridge',
          explicit: true,
        });
        return json(res, 200, { ok: true, active: active.length });
      } catch (err) {
        return json(res, 500, { ok: false, error: errorMessage(err) });
      }
    })();
  });


  /**
   * POST /api/memory/ingest  { chat, uid, name?, text, ts?, msgId?, chatType? }
   *
   * 桥接失联/重启期间跳过的消息，至少写进记忆原文（不触发回复）。
   * 只允许本机；会话必须已存在（不凭空建会话）。
   */
  router.post('/api/memory/ingest', (runtime, req, res) => {
    if (!isLoopbackRequest(req)) return json(res, 403, { ok: false, error: '记忆写入只允许在本机操作' });
    // 本机也要凭证：否则任意本地进程都能以主人身份写记忆
    const want = String((((runtime.config || {}).gateway || {}).wechat || {}).inboundToken || '');
    const got = String(req.headers['x-whale-bridge-token'] || '');
    if (!want || got !== want) return json(res, 403, { ok: false, error: '桥接 token 不正确' });
    return (async () => {
      try {
        const body = await readBody(req);
        const chat = String((body && body.chat) || '').trim();
        const uid = String((body && body.uid) || '').trim();
        const text = String((body && body.text) || '').trim();
        if (!chat || !uid || !text) return json(res, 400, { ok: false, error: 'chat / uid / text 都不能为空' });
        const chats = runtime.store.chatStore.chats;
        if (!chats || typeof chats.get !== 'function' || !chats.get(chat)) {
          return json(res, 404, { ok: false, error: '会话不存在，拒绝写入（避免凭空建会话）' });
        }
        // 同一条消息已经进过记忆就不要重复写
        const msgId = String((body && body.msgId) || '');
        if (msgId && runtime.store.isDuplicate(chat, msgId)) {
          return json(res, 200, { ok: true, skipped: 'duplicate' });
        }
        const ts = Number(body.ts) || Date.now();
        const entry = runtime.store.recordUser(chat, {
          platform: 'wechat',
          chatType: body.chatType === 'group' ? 'group' : 'private',
          chatId: chat.split(':').pop(),
          senderId: uid,
          senderName: String(body.name || ''),
          msgId,
        }, text.slice(0, 4000), { ts, silent: true });
        return json(res, 200, { ok: true, seq: entry && entry.seq });
      } catch (err) {
        return json(res, 500, { ok: false, error: errorMessage(err) });
      }
    })();
  });

  // POST /api/memory/sleep  { force?: true } —— 手动触发夜间整理（只允许本机）
  router.post('/api/memory/sleep', (runtime, req, res) => {
    if (!isLoopbackRequest(req)) return json(res, 403, { ok: false, error: '只允许本机' });
    return (async () => {
      try {
        const body = await readBody(req);
        const ms = require('../../services/memorySleep');
        const dataDir = runtime.config.paths.dataDir;
        const report = body && body.force
          ? ms.run({ dataDir, store: runtime.store, logger: runtime.logger })
          : ms.maybeRun({ dataDir, store: runtime.store, logger: runtime.logger });
        return json(res, 200, { ok: true, report });
      } catch (err) {
        return json(res, 500, { ok: false, error: errorMessage(err) });
      }
    })();
  });

  function registerList(route, field, groupsOnly) {
  router.get(route, (runtime, req, res) => {
    if (!isLoopbackRequest(req)) return json(res, 403, { ok: false, error: '记忆管理只允许在本机操作' });
    const groups = [...runtime.store.chatStore.chats.values()]
      .filter((chat) => !groupsOnly || chat.platform === 'wechat' && chat.chatType === 'group')
      .map((chat) => ({ key: chat.chatId, title: chat.title || chat.chatId, chatType: chat.chatType, platform: chat.platform,
        messageCount: chat.messages.length, peopleCount: chat.people.size, lastActiveAt: chat.lastActiveAt }))
      .sort((a, b) => b.lastActiveAt - a.lastActiveAt);
    return json(res, 200, { ok: true, [field]: groups });
  });
  }

  function registerReset(route, groupsOnly) {
  router.post(route, async (runtime, req, res) => {
    if (!isLoopbackRequest(req)) return json(res, 403, { ok: false, error: '记忆管理只允许在本机操作' });
    const body = await readBody(req);
    if (!body || typeof body.key !== 'string' || body.confirm !== true) {
      return json(res, 400, { ok: false, error: '请选择对话并确认清空' });
    }
    const chat = runtime.store.chatStore.chats.get(body.key);
    if (!chat || groupsOnly && (chat.platform !== 'wechat' || chat.chatType !== 'group')) {
      return json(res, 404, { ok: false, error: '该对话没有可清空的记忆，请刷新列表' });
    }
    // 回复结束前不能删：进行中的管线会继续追加带旧上下文的回复。
    if (runtime.bot._handleChains.has(body.key)) {
      return json(res, 409, { ok: false, error: '该对话正在处理消息，请等回复结束后再清空' });
    }
    try {
      if (!runtime.store.resetSession(body.key)) throw new Error('无法删除对话记忆文件，请检查文件占用或目录权限');
      runtime.logger.info('已清空一个对话的内部记忆');
      return json(res, 200, { ok: true });
    } catch (err) {
      runtime.logger.warn('清空对话记忆失败：' + describeError(err));
      return json(res, 500, { ok: false, error: (err && err.message) || '清空失败' });
    }
  });
  }
  registerList('/api/memory/chats', 'chats', false);
  registerReset('/api/memory/chats/reset', false);
  registerList('/api/memory/groups', 'groups', true);
  registerReset('/api/memory/groups/reset', true);

  router.get('/api/memory/import/status', (runtime, req, res) => {
    if (!isLoopbackRequest(req)) return json(res, 403, { ok: false, error: '旧记忆检测只允许在本机操作' });
    try {
      const status = migrate.legacyStatus({ memoryDir: memoryDirOf(runtime), chatStore: runtime.store.chatStore });
      return json(res, 200, { ok: true, ...status });
    } catch (err) {
      runtime.logger.warn('旧记忆检测失败：' + describeError(err));
      return json(res, 500, { ok: false, error: '检测失败：' + errorMessage(err) });
    }
  });

  router.get('/api/memory/import/notice', (runtime, req, res) => {
    if (!isLoopbackRequest(req)) return json(res, 403, { ok: false, error: '旧记忆提示只允许在本机操作' });
    return json(res, 200, { ok: true, notice: migrate.readImportNotice(memoryDirOf(runtime)) });
  });

  router.post('/api/memory/import/ack', (runtime, req, res) => {
    if (!isLoopbackRequest(req)) return json(res, 403, { ok: false, error: '旧记忆提示只允许在本机操作' });
    try {
      return json(res, 200, { ok: true, ...migrate.ackImportNotice(memoryDirOf(runtime)) });
    } catch (err) {
      // 不要 String(err)：异常对象可能把堆栈带进响应（CodeQL js/stack-trace-exposure）。
      return json(res, 500, { ok: false, error: errorMessage(err, '确认旧记忆提示失败') });
    }
  });

  router.post('/api/memory/import', (runtime, req, res) => {
    if (!isLoopbackRequest(req)) return json(res, 403, { ok: false, error: '旧记忆转换只允许在本机操作' });
    if (running) return json(res, 409, { ok: false, error: '已经有一次转换在进行，稍等几秒再试' });
    running = true;
    try {
      const memoryDir = memoryDirOf(runtime);
      const result = migrate.migrateIfNeeded({
        memoryDir,
        chatStore: runtime.store.chatStore,
        logger: runtime.logger,
      });
      if (!result.report) {
        return json(res, 200, { ok: true, idle: true, pending: false, message: '没有发现待转换的旧版记忆' });
      }
      // 新建的 chat 要出现在 sessions 视图里；不重建对象，避免打断进行中的回复
      try { runtime.store.refreshSessions(); } catch { /* 视图同步失败不影响已落盘的数据 */ }
      const report = result.report;
      runtime.logger.info(
        `手动转换旧记忆：新增 ${report.imported} / 合并 ${report.merged} 个聊天、补 ${report.messages} 条消息、${report.notes} 条偏好`
      );
      return json(res, 200, {
        ok: true,
        idle: false,
        pending: false,
        sources: result.sources,
        imported: report.imported,
        merged: report.merged,
        unchanged: report.unchanged,
        skipped: report.skipped,
        messages: report.messages,
        notes: report.notes,
        chats: report.chats.length,
      });
    } catch (err) {
      runtime.logger.warn('手动转换旧记忆失败：' + describeError(err));
      return json(res, 500, { ok: false, error: '转换失败：' + errorMessage(err) });
    } finally {
      running = false;
    }
  });
};
