'use strict';
/**
 * 出生技能 · Job 状态机 + 进程树清理（B3-03）。
 *
 * 纯状态机，不直接杀进程；kill 通过注入，方便单测。
 * 关键约束：
 *  - R2 需 1 次主人确认，R3 需 2 次；未确认不能 start；
 *  - cancel 后 2s 内必须到 cancelled；
 *  - 终态不可再执行；
 *  - 进程树 children-first；killTree 幂等；无孤儿。
 */
const REQUIRED = Object.freeze({ R0: 0, R1: 0, R2: 1, R3: 2 });
const TERMINAL = new Set(['succeeded', 'failed', 'cancelled', 'timed_out', 'rejected']);
const CANCEL_DEADLINE_MS = 2000;

function createJob({ id, risk = 'R0', action = '', goal = '', timeoutMs = 120000, now = Date.now() } = {}) {
  if (!id) throw new Error('job id required');
  if (!(risk in REQUIRED)) throw new Error('risk required');
  let state = REQUIRED[risk] > 0 ? 'awaiting_approval' : 'queued';
  let approvals = [];
  let startedAt = 0;
  let finishedAt = 0;
  let cancelAt = 0;
  let cancelDeadline = 0;
  let cancelledAt = 0;
  let timeoutAt = Number(timeoutMs) > 0 ? now + Number(timeoutMs) : 0;
  let result = null;

  function snapshot() {
    return {
      id, risk, action, goal, state,
      approvals: [...approvals],
      required: REQUIRED[risk],
      startedAt, finishedAt, cancelAt, cancelDeadline, cancelledAt,
      timeoutAt, result: result ? { ...result } : null,
      stopMs: cancelAt && cancelledAt ? cancelledAt - cancelAt : 0,
    };
  }
  function fail(msg) { throw new Error(msg); }
  function approve(approver, at = Date.now()) {
    if (state !== 'awaiting_approval') fail('not awaiting approval');
    const who = String(approver || '').trim();
    if (!who) fail('approver required');
    if (!approvals.includes(who)) approvals.push(who);
    if (approvals.length >= REQUIRED[risk]) state = 'queued';
    return snapshot();
  }
  function reject(approver = 'owner', at = Date.now()) {
    if (state !== 'awaiting_approval') fail('not awaiting approval');
    state = 'rejected'; finishedAt = at;
    result = { by: String(approver || 'owner') };
    return snapshot();
  }
  function start(at = Date.now()) {
    if (state !== 'queued') fail('not queued');
    state = 'running'; startedAt = at;
    if (timeoutAt && at > timeoutAt) timeoutAt = at + timeoutMs;
    return snapshot();
  }
  function cancel(at = Date.now()) {
    if (TERMINAL.has(state) || state === 'cancelling') return snapshot();
    state = 'cancelling';
    cancelAt = at;
    cancelDeadline = at + CANCEL_DEADLINE_MS;
    return snapshot();
  }
  function markStopped(at = Date.now()) {
    if (state !== 'cancelling') return snapshot();
    state = 'cancelled'; cancelledAt = at; finishedAt = at;
    return snapshot();
  }
  function tick(at = Date.now()) {
    if (state === 'cancelling' && at >= cancelDeadline) return markStopped(cancelDeadline);
    if (state === 'running' && timeoutAt && at >= timeoutAt) {
      state = 'timed_out'; finishedAt = timeoutAt; cancelledAt = timeoutAt;
    }
    return snapshot();
  }
  function succeed(value = null, at = Date.now()) {
    if (state !== 'running') fail('not running');
    state = 'succeeded'; finishedAt = at; result = { value };
    return snapshot();
  }
  function failJob(reason = '', at = Date.now()) {
    if (state !== 'running') fail('not running');
    state = 'failed'; finishedAt = at; result = { error: String(reason).slice(0, 300) };
    return snapshot();
  }
  return { snapshot, approve, reject, start, cancel, markStopped, tick, succeed, fail: failJob };
}

function createProcessTracker({ kill, isAlive = () => true } = {}) {
  if (typeof kill !== 'function') throw new Error('kill required');
  const parents = new Map();
  const dead = new Set();
  function add(pid, parent = 0) { parents.set(Number(pid), Number(parent) || 0); }
  function children(pid) {
    const p = Number(pid);
    return [...parents.keys()].filter((x) => parents.get(x) === p);
  }
  function tree(root) {
    const out = [];
    const walk = (p) => { for (const c of children(p)) { out.push(c); walk(c); } };
    walk(Number(root));
    return [Number(root), ...out];
  }
  function killTree(root) {
    const all = tree(root);
    const killed = [];
    // children-first，避免父死子留
    for (const pid of all.slice().reverse()) {
      if (dead.has(pid)) continue;
      try { kill(pid); } catch { /* 已退出也视为清掉 */ }
      dead.add(pid); killed.push(pid);
    }
    return { killed, orphans: orphans() };
  }
  function orphans() {
    return [...parents.keys()].filter((pid) => !dead.has(pid) && parents.get(pid) !== 0 && dead.has(parents.get(pid)));
  }
  return { add, children, tree, killTree, orphans, dead: () => new Set(dead) };
}

module.exports = { REQUIRED, TERMINAL, CANCEL_DEADLINE_MS, createJob, createProcessTracker };
