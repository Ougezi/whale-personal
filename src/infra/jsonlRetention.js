'use strict';
/** JSONL 轮转：超过 maxBytes 时依次推到 .1/.2/...，最多保留 maxFiles 个历史。 */
const fs = require('node:fs');

function rotate(file, { maxBytes = 5 * 1024 * 1024, maxFiles = 3 } = {}) {
  try {
    if (!file || !fs.existsSync(file)) return false;
    const size = fs.statSync(file).size;
    if (size < Number(maxBytes)) return false;
    const keep = Math.max(1, Math.min(20, Number(maxFiles) || 3));
    for (let i = keep; i >= 1; i -= 1) {
      const src = i === 1 ? file : `${file}.${i - 1}`;
      const dst = `${file}.${i}`;
      if (!fs.existsSync(src)) continue;
      try { if (fs.existsSync(dst)) fs.unlinkSync(dst); } catch { /* ignore */ }
      fs.renameSync(src, dst);
    }
    return true;
  } catch {
    return false;
  }
}

module.exports = { rotate };
