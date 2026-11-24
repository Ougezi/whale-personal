// 浏览器缓存清理（2026-11-24）：只清可再生缓存，绝不动登录态
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ALWAYS = [
  'Default/Cache', 'Default/Code Cache', 'Default/GPUCache',
  'ShaderCache', 'GrShaderCache', 'BrowserMetrics-spare.pma',
];
const IF_OLD = ['component_crx_cache', 'CertificateRevocation', 'WasmTtsEngine', 'ActorSafetyLists'];

function rm(target) {
  try {
    const st = fs.statSync(target);
    if (st.isDirectory()) fs.rmSync(target, { recursive: true, force: true });
    else fs.rmSync(target, { force: true });
    return true;
  } catch { return false; }
}

function cleanup(dir, { now = Date.now(), maxAgeDays = 7 } = {}) {
  let removed = 0;
  let freed = 0;
  if (!dir || !fs.existsSync(dir)) return { removed, freedMB: 0 };
  const sizeOf = (target) => {
    try {
      const st = fs.statSync(target);
      if (st.isFile()) return st.size;
      let n = 0;
      for (const f of fs.readdirSync(target, { withFileTypes: true })) {
        const p = path.join(target, f.name);
        n += f.isDirectory() ? sizeOf(p) : (() => { try { return fs.statSync(p).size; } catch { return 0; } })();
      }
      return n;
    } catch { return 0; }
  };
  for (const rel of ALWAYS) {
    const target = path.join(dir, rel);
    if (!fs.existsSync(target)) continue;
    const n = sizeOf(target);
    if (rm(target)) { removed += 1; freed += n; }
  }
  const cutoff = now - Math.max(1, Number(maxAgeDays) || 7) * 86400000;
  for (const rel of IF_OLD) {
    const target = path.join(dir, rel);
    if (!fs.existsSync(target)) continue;
    let mtime = 0;
    try { mtime = fs.statSync(target).mtimeMs; } catch { continue; }
    if (mtime > cutoff) continue;
    const n = sizeOf(target);
    if (rm(target)) { removed += 1; freed += n; }
  }
  return { removed, freedMB: Math.round(freed / 1048576) };
}

module.exports = { cleanup, ALWAYS, IF_OLD };
