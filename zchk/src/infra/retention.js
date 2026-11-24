// 运行日志/追踪保留策略（2026-11-24）：长期挂着也要能回收
'use strict';

const fs = require('node:fs');
const path = require('node:path');

function pruneOldDirs(dir, { now = Date.now(), maxAgeDays = 14, prefix = '' } = {}) {
  let removed = 0;
  try {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!e.isDirectory() || (prefix && !e.name.startsWith(prefix))) continue;
      const target = path.join(dir, e.name);
      let mtime = 0;
      try { mtime = fs.statSync(target).mtimeMs; } catch { continue; }
      if (now - mtime < Math.max(1, Number(maxAgeDays) || 14) * 86400000) continue;
      try { fs.rmSync(target, { recursive: true, force: true }); removed += 1; } catch { /* 占用中跳过 */ }
    }
  } catch { /* 目录不存在 */ }
  return removed;
}

function pruneOldFiles(dir, { now = Date.now(), maxAgeDays = 14 } = {}) {
  let removed = 0;
  try {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!e.isFile()) continue;
      const target = path.join(dir, e.name);
      let mtime = 0;
      try { mtime = fs.statSync(target).mtimeMs; } catch { continue; }
      if (now - mtime < Math.max(1, Number(maxAgeDays) || 14) * 86400000) continue;
      try { fs.unlinkSync(target); removed += 1; } catch { /* 占用中跳过 */ }
    }
  } catch { /* 目录不存在 */ }
  return removed;
}

module.exports = { pruneOldDirs, pruneOldFiles };
