// 每天说了多少话（token）：额度快用完时她会"饿"（2026-11 P2）
// 只记数字，不存正文；文件坏了就当今天没说过话。
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const DEFAULT_LIMIT = 1500000;   // 每天约 180 条消息

function dirOf(dir) { return dir || path.join(ROOT, 'data'); }
function fileOf(dir) { return path.join(dirOf(dir), 'usage.json'); }
function today(now = Date.now()) {
  const d = new Date(now);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function load(dir) {
  try {
    const raw = JSON.parse(fs.readFileSync(fileOf(dir), 'utf8'));
    return raw && typeof raw === 'object' ? raw : {};
  } catch { return {}; }
}

function save(dir, data) {
  try {
    const file = fileOf(dir);
    const tmp = file + '.tmp';
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(tmp, JSON.stringify(data), 'utf8');
    fs.renameSync(tmp, file);
  } catch { /* 记账失败不影响聊天 */ }
}

/** 记一笔。tokens 为本轮输入+输出总量。 */
function record(tokens, { cost = null, at = Date.now(), dir = null, limit = DEFAULT_LIMIT } = {}) {
  const n = Math.max(0, Math.round(Number(tokens) || 0));
  if (!n) return state({ dir, at, limit });
  const data = load(dir);
  const day = today(at);
  const cur = data && data.day === day ? data : { day, tokens: 0, cost: 0, calls: 0 };
  cur.tokens += n;
  cur.calls += 1;
  if (Number.isFinite(Number(cost))) cur.cost = Number(((Number(cur.cost) || 0) + Number(cost)).toFixed(6));
  cur.limit = Math.max(1, Number(limit) || DEFAULT_LIMIT);
  save(dir, cur);
  return { day, tokens: cur.tokens, cost: cur.cost, calls: cur.calls, limit: cur.limit, ratio: cur.tokens / cur.limit };
}

function state({ dir = null, at = Date.now(), limit = DEFAULT_LIMIT } = {}) {
  const data = load(dir);
  const day = today(at);
  const fresh = !data || data.day !== day;
  const tokens = fresh ? 0 : Math.max(0, Number(data.tokens) || 0);
  const cap = Math.max(1, Number(limit) || DEFAULT_LIMIT);
  return { day, tokens, cost: fresh ? 0 : Number(data.cost) || 0, calls: fresh ? 0 : Number(data.calls) || 0,
    limit: cap, ratio: tokens / cap };
}

/**
 * 饿的提示：用量过半才提，越接近越明显。
 * 返回 '' 或一句给模型的状态（不是人设，别解释原因）。
 */
function hungerLine(opts = {}) {
  const s = state(opts);
  const pct = Math.round(s.ratio * 100);
  if (s.ratio >= 0.95) return `【有点饿】今天能说的话只剩 ${100 - pct}% 了；合适的话可以说一句"我快没力气说话了，今天先聊到这儿？"——别解释 token 或额度。`;
  if (s.ratio >= 0.85) return `【有点饿】今天说话的额度用了 ${pct}%；可以自然地说一句"有点饿了"，别解释原因。`;
  return '';
}

module.exports = { record, state, hungerLine, today, DEFAULT_LIMIT };
