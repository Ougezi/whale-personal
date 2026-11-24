'use strict';
/**
 * 出生技能 · 回执 → 记忆（B5-02）。
 *
 * 只认回执，不靠猜：
 *  - pending → sent → delivered / failed / timeout；
 *  - 没有回执不能声称“已发/已送达”；
 *  - delivered 才写成功情节/能力计数；failed/timeout 写失败教训；
 *  - promise=true 的消息在 delivered 后写承诺记忆。
 */
const STATES = ['pending', 'sent', 'delivered', 'failed', 'timeout'];
const TERMINAL = new Set(['delivered', 'failed', 'timeout']);

function createReceiptTracker({ now = Date.now } = {}) {
  const receipts = new Map();
  const memories = [];
  const capabilities = new Map();

  function register({ id, target, text = '', kind = 'say', promise = false, at = now() } = {}) {
    if (!id) throw new Error('message id required');
    if (!target) throw new Error('target required');
    if (receipts.has(id)) return { duplicate: true, receipt: snapshot(id) };
    receipts.set(id, { id, target, text: String(text).slice(0, 2000), kind, promise: Boolean(promise), state: 'pending', at, detail: '' });
    return { duplicate: false, receipt: snapshot(id) };
  }

  function mark(id, state, { at = now(), detail = '' } = {}) {
    const r = receipts.get(id);
    if (!r) throw new Error('unknown receipt: ' + id);
    if (!STATES.includes(state)) throw new Error('bad state: ' + state);
    if (TERMINAL.has(r.state)) {
      if (r.state === state) return snapshot(id); // 幂等
      throw new Error('terminal state: ' + r.state);
    }
    const allowed = {
      pending: ['sent', 'failed', 'timeout'],
      sent: ['delivered', 'failed', 'timeout'],
    };
    if (!(allowed[r.state] || []).includes(state)) throw new Error('invalid transition ' + r.state + '->' + state);
    r.state = state; r.at = at; r.detail = String(detail).slice(0, 300);
    if (state === 'delivered') {
      const cap = r.kind || 'say';
      capabilities.set(cap, (capabilities.get(cap) || 0) + 1);
      memories.push({ kind: 'episode', source: 'receipt', messageId: id, target: r.target, ok: true, at });
      if (r.promise) memories.push({ kind: 'promise', source: 'receipt', messageId: id, target: r.target, ok: true, at });
    } else if (state === 'failed' || state === 'timeout') {
      memories.push({ kind: 'lesson', source: 'receipt', messageId: id, target: r.target, ok: false, reason: state, at });
    }
    return snapshot(id);
  }

  function snapshot(id) {
    const r = receipts.get(id);
    return r ? { ...r } : null;
  }

  function canClaim(id, claim) {
    const r = receipts.get(id);
    if (!r) return false;
    if (claim === 'sent') return r.state === 'sent' || r.state === 'delivered';
    if (claim === 'delivered') return r.state === 'delivered';
    return false;
  }

  function assertClaim(id, claim) {
    if (!canClaim(id, claim)) throw new Error('no receipt for claim: ' + claim);
    return true;
  }

  function coverage(expected) {
    const n = Number(expected) || 0;
    if (n <= 0) return 1;
    const covered = [...receipts.values()].filter((r) => r.state !== 'pending').length;
    return Math.min(1, covered / n);
  }

  function stats() {
    const byState = {};
    for (const r of receipts.values()) byState[r.state] = (byState[r.state] || 0) + 1;
    return { total: receipts.size, byState, capabilities: Object.fromEntries(capabilities) };
  }

  return { register, mark, snapshot, canClaim, assertClaim, coverage, stats, memories: () => memories.map((m) => ({ ...m })) };
}

module.exports = { STATES, TERMINAL, createReceiptTracker };
