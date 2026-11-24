'use strict';
/**
 * 出生技能 · 记忆核心：working / session / instruction。
 *
 * 三层分开，不混成一个 prompt 大袋：
 *  - working：当前回合的 7 个槽，最多 1000 字；
 *  - session：当前会话最近消息 + 当前任务，限量；
 *  - instruction：行为规则，按 owner > config > default 解析，规则不能被事实覆盖。
 *
 * 本步只做核心模块；B1-04 才接现有 prompt/memory 主链。
 */
const LIMITS = Object.freeze({
  workingSlots: 7,
  workingChars: 1000,
  sessionMessages: 12,
  sessionChars: 3000,
  instructionRules: 40,
});

function text(value, max) {
  return String(value == null ? '' : value).slice(0, max);
}
function estimateTokens(value) {
  const s = String(value || '');
  // 中文按 1 字≈1 token 粗估；英文按 4 字符≈1 token；只用于预算护栏。
  const han = (s.match(/[\u4e00-\u9fff]/g) || []).length;
  const rest = s.length - han;
  return han + Math.ceil(rest / 4);
}

function createWorkingMemory({ maxSlots = LIMITS.workingSlots, maxChars = LIMITS.workingChars } = {}) {
  let slots = [];
  function trim() {
    while (slots.length > maxSlots) slots.shift();
    let total = slots.reduce((n, s) => n + s.text.length, 0);
    while (total > maxChars && slots.length) {
      const drop = slots.shift();
      total -= drop.text.length;
    }
    return total;
  }
  function set(key, value, at = Date.now()) {
    const k = text(key, 80);
    if (!k) throw new Error('working key required');
    slots = slots.filter((s) => s.key !== k);
    slots.push({ key: k, text: text(value, 300), at });
    trim();
    return snapshot();
  }
  function get(key) {
    const hit = slots.find((s) => s.key === key);
    return hit ? hit.text : '';
  }
  function latest() { return slots.length ? slots[slots.length - 1] : null; }
  function list() { return slots.map((s) => ({ ...s })); }
  function clear() { slots = []; }
  function snapshot() {
    return { slots: list(), chars: slots.reduce((n, s) => n + s.text.length, 0), tokens: estimateTokens(slots.map((s) => s.text).join('\n')), maxSlots, maxChars };
  }
  return { set, get, latest, list, clear, snapshot };
}

function createSessionMemory({ maxMessages = LIMITS.sessionMessages, maxChars = LIMITS.sessionChars } = {}) {
  let messages = [];
  let task = '';
  function add({ role = 'user', text: t = '', at = Date.now(), id = '' } = {}) {
    messages.push({ id: text(id, 80), role: text(role, 16), text: text(t, 800), at });
    let total = messages.reduce((n, m) => n + m.text.length, 0);
    while ((messages.length > maxMessages || total > maxChars) && messages.length) {
      const drop = messages.shift();
      total -= drop.text.length;
    }
    return snapshot();
  }
  function setTask(value) { task = text(value, 500); return snapshot(); }
  function latest() { return messages.length ? messages[messages.length - 1] : null; }
  function clear() { messages = []; task = ''; }
  function snapshot() {
    const chars = messages.reduce((n, m) => n + m.text.length, 0) + task.length;
    return { messages: messages.map((m) => ({ ...m })), task, chars, tokens: estimateTokens(messages.map((m) => m.text).join('\n') + task), maxMessages, maxChars };
  }
  return { add, setTask, latest, clear, snapshot };
}

const SOURCE_RANK = { owner: 3, config: 2, default: 1 };
function createInstructionMemory({ maxRules = LIMITS.instructionRules } = {}) {
  let rules = [];
  function add({ id, text: t, source = 'config', scope = 'global', at = Date.now() } = {}) {
    if (!SOURCE_RANK[source]) throw new Error('instruction source must be owner/config/default');
    const body = text(t, 300).trim();
    if (!body) throw new Error('instruction text required');
    const key = text(id, 80) || body.slice(0, 40);
    rules = rules.filter((r) => r.key !== key);
    rules.push({ key, text: body, source, scope: text(scope, 40), at });
    rules.sort((a, b) => (SOURCE_RANK[b.source] - SOURCE_RANK[a.source]) || (b.at - a.at));
    while (rules.length > maxRules) rules.pop();
    return list(scope);
  }
  function list(scope = 'global') {
    return rules.filter((r) => r.scope === 'global' || r.scope === scope).map((r) => ({ ...r }));
  }
  function resolve(scope = 'global') {
    // 同一 key 只保留最高优先级；owner 最新优先，config 次之，default 最后。
    const seen = new Set();
    const out = [];
    for (const r of list(scope)) {
      if (seen.has(r.key)) continue;
      seen.add(r.key);
      out.push(r);
    }
    return out;
  }
  function clear() { rules = []; }
  return { add, list, resolve, clear, count: () => rules.length };
}

/** 解析“那个/刚才/上次”这类指代：只从 working/session 里取，不猜。 */
function resolvePointer(value, working, session) {
  const s = String(value || '');
  if (!/刚才|那个|上次|上一条|前面|继续/.test(s)) return null;
  const w = working && working.latest ? working.latest() : null;
  if (w) return { kind: 'working', key: w.key, text: w.text };
  const m = session && session.latest ? session.latest() : null;
  if (m) return { kind: 'session', id: m.id, text: m.text };
  return null;
}

module.exports = { LIMITS, estimateTokens, createWorkingMemory, createSessionMemory, createInstructionMemory, resolvePointer };
