// 内心记录只读接口（2026-11-22）：给启动器/诊断页看「她写过什么」。
// 只读、只允许本机，不提供删除/编辑（写入口在她自己的回复标记里）。
'use strict';

const path = require('node:path');
const fs = require('node:fs');
const { json } = require('../util');
const { isLoopbackRequest } = require('../security');
const innerNotes = require('../../core/innerNotes');

module.exports = function register(router) {
  const local = (req) => {
    if (!isLoopbackRequest(req)) throw Object.assign(new Error('内心记录接口仅允许本机访问'), { statusCode: 403 });
  };
  const dirOf = (runtime) => path.join(runtime.config.paths.dataDir);

  // GET /api/inner → 两种记录各最近 10 条
  router.get('/api/inner', (runtime, req, res) => {
    local(req);
    const dir = dirOf(runtime);
    return json(res, 200, {
      ok: true,
      feelings: innerNotes.recent('feelings', 10, { dir }),
      lessons: innerNotes.recent('lessons', 10, { dir }),
    });
  });

  // GET /api/inner?kind=insights：睡眠任务产出的洞察（只读）
  router.get('/api/inner/insights', (runtime, req, res) => {
    local(req);
    let limit = 20;
    try {
      const u = new URL(req.url, 'http://localhost');
      limit = Math.max(1, Math.min(50, Number(u.searchParams.get('limit')) || 20));
    } catch { /* 参数坏了用默认 */ }
    let lines = [];
    try {
      const file = path.join(runtime.config.paths.dataDir, 'inner', 'insights.md');
      lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).slice(-limit);
    } catch { /* 没产出就空 */ }
    return json(res, 200, { ok: true, items: lines });
  });

  // GET /api/inner/list?kind=feelings|lessons&limit=20
  router.get('/api/inner/list', (runtime, req, res) => {
    local(req);
    let kind = 'feelings';
    let limit = 20;
    try {
      const u = new URL(req.url, 'http://localhost');
      if (u.searchParams.get('kind') === 'lessons') kind = 'lessons';
      limit = Math.max(1, Math.min(50, Number(u.searchParams.get('limit')) || 20));
    } catch { /* 参数坏了就用默认 */ }
    return json(res, 200, { ok: true, kind, items: innerNotes.recent(kind, limit, { dir: dirOf(runtime) }) });
  });
};
