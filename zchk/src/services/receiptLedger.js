'use strict';
/** I-17：桥接回执 → receipts.js 账本。 */
const { createReceiptTracker } = require('../../packages/memory-core/receipts.js');

function createReceiptLedger({ logger = null } = {}) {
  const tracker = createReceiptTracker();
  const recent = [];
  function ingest(row = {}) {
    const target = String(row.target || '').trim();
    if (!target) return { ok: false, error: 'target required' };
    const at = Number(row.at) || Date.now();
    const id = String(row.id || `send:${at}:${row.hash || ''}`);
    const reg = tracker.register({ id, target, text: row.text || row.preview || '', kind: 'send', at });
    if (reg.duplicate) return { ok: true, duplicate: true, receipt: reg.receipt };
    let state = 'failed';
    let receipt = null;
    if (row.ok) {
      tracker.mark(id, 'sent', { at, detail: row.reason || '' });
      state = 'delivered';
      receipt = tracker.mark(id, 'delivered', { at, detail: row.reason || '' });
    } else {
      receipt = tracker.mark(id, 'failed', { at, detail: row.reason || '' });
    }
    recent.push(receipt);
    while (recent.length > 200) recent.shift();
    if (logger) logger.info(`发送回执：${state} ${target} ${String(row.reason || '')}`.trim());
    return { ok: true, duplicate: false, receipt };
  }
  function stats() { return tracker.stats(); }
  function last(limit = 20) { return recent.slice(-Math.max(1, Number(limit) || 20)); }
  return { ingest, stats, last, tracker };
}

module.exports = { createReceiptLedger };
