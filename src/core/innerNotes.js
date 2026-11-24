// 内心记录：感受 / 教训（2026-11-22）
// 她自己写、自己读：写进 data/inner/，下一轮带进提示词；日记仍由 services/diary.js 负责。
// 设计原则：纯本地、失败不影响回复、条目有上限（不让她把文件写成无限长）。
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const KINDS = Object.freeze({ feel: 'feelings', lesson: 'lessons' });
const FILES = Object.freeze({ feelings: 'feelings.md', lessons: 'lessons.md' });
const MAX_ENTRY = 200;      // 一条最多 200 字
const MAX_LINES = 200;      // 每个文件最多留 200 条
// 行格式：- [MM-DD HH:mm] (pending|confirmed|archived) 正文；旧行没有状态 = confirmed
const LINE_RE = /^- \[(\d{2}-\d{2} \d{2}:\d{2})\] (?:\((pending|confirmed|archived)\) )?(.*)$/;

function baseDir(dir) {
  if (dir) return path.join(dir, 'inner');
  return path.join(process.cwd(), 'data', 'inner');
}

function canon(kind) {
  const k = String(kind || '').toLowerCase();
  if (FILES[k]) return k;
  return KINDS[k] || '';
}

function fileOf(kind, dir) {
  const name = FILES[canon(kind)];
  return name ? path.join(baseDir(dir), name) : '';
}

function today(now = Date.now()) {
  const d = new Date(now);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

function stamp(now) {
  const d = new Date(now);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function readLines(kind, dir) {
  const file = fileOf(canon(kind), dir);
  if (!file) return [];
  try {
    return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);
  } catch { return []; }
}

function writeLines(kind, dir, lines) {
  const file = fileOf(canon(kind), dir);
  if (!file) return false;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const kept = lines.slice(-MAX_LINES);
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, kept.join('\n') + (kept.length ? '\n' : ''), 'utf8');
    fs.renameSync(tmp, file);
    return true;
  } catch { return false; }
}

/** 记一条感受或教训。返回 { ok, kind }。 */
function append(kind, text, { dir = null, now = Date.now(), status = '' } = {}) {
  const k = canon(kind);
  if (!k) return { ok: false, kind };
  const body = String(text == null ? '' : text).replace(/\s+/g, ' ').trim().slice(0, MAX_ENTRY);
  if (!body) return { ok: false, kind };
  const file = fileOf(k, dir);
  if (!file) return { ok: false, kind: k };
  if (isDuplicate(k, body, dir)) return { ok: true, kind: k, duplicate: true };
  // 教训默认待确认，感受默认确认；已确认的不写状态标记（兼容旧格式）
  const st = ['pending', 'confirmed', 'archived'].includes(String(status))
    ? String(status) : (k === 'lessons' ? 'pending' : 'confirmed');
  const prefix = st === 'confirmed' ? '' : `(${st}) `;
  try {
    // appendFileSync 是单次 O_APPEND 写：并发消息不会互相覆盖（2026-11-22）
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, `- [${stamp(now)}] ${prefix}${body}\n`, 'utf8');
    // 超过上限再压缩一次；不每写一条都重写整个文件
    const lines = readLines(k, dir);
    if (lines.length > MAX_LINES + 20) writeLines(k, dir, lines);
    return { ok: true, kind: k };
  } catch (err) {
    return { ok: false, kind: k };
  }
}

/** 最近 n 条（旧→新）；status 传了就只取该状态，不传取全部。 */
function recent(kind, n = 2, { dir = null, status = null } = {}) {
  const out = [];
  for (const line of readLines(kind, dir)) {
    const m = LINE_RE.exec(line);
    if (!m) continue;
    const st = m[2] || 'confirmed';   // 旧行没有状态 = 已确认
    if (status && st !== status) continue;
    out.push({ at: m[1], text: m[3], status: st });
  }
  return out.slice(-Math.max(1, Math.min(20, n)));
}

/** 给提示词的一段；没有记录就返回空串。 */
function block({ dir = null, limit = 2 } = {}) {
  try { prune({ dir }); } catch { /* 过期清理失败不影响读取 */ }
  const feelings = recent('feelings', limit, { dir, status: 'confirmed' });
  const lessons = recent('lessons', limit, { dir, status: 'confirmed' });
  if (!feelings.length && !lessons.length) return '';
  const parts = [];
  if (feelings.length) parts.push('感受：' + feelings.map((x) => x.text).join('；'));
  if (lessons.length) parts.push('教训：' + lessons.map((x) => x.text).join('；'));
  return `【心里记着的】${parts.join('。')}（这些是你自己以前写下的，可以自然带出来，不必复述原文）`;
}

/** 从回复里收走 [[feel:…]] / [[lesson:…]]，写盘并从正文删除。 */
function consume(text, { dir = null, now = Date.now() } = {}) {
  const src = String(text == null ? '' : text);
  const writes = [];
  // 中英文冒号都收（模型经常写全角）
  // 正文长度不限：超长时截断存储，但标记必须从正文里拿干净（否则会漏给用户看）
  const cleaned = src.replace(/\[\[(feel|lesson)[:：]\s*([^\]\n]*)(?:\]\]|$)/gi, (all, kind, body) => {
    const k = String(kind).toLowerCase();
    if (append(k, body, { dir, now }).ok) writes.push({ kind: k, text: String(body).trim().slice(0, 60) });
    return '';
  });
  // 兜底：没写冒号或写成半截的 [[feel ... 也一并清掉，不留残渣
  const cleanedText = cleaned
    .replace(/\[\[(feel|lesson)[^\]\n]*\]*/gi, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/([^\n])[ \t]{2,}/g, '$1 ')
    .trim();
  return { text: cleanedText, writes };
}

/** 同一条不重复写：最近 30 条里有一样的就跳过（返回 duplicate） */
function isDuplicate(kind, body, dir) {
  const list = recent(kind, 30, { dir });
  const norm = (x) => String(x || '').replace(/\s+/g, '');
  return list.some((x) => norm(x.text) === norm(body));
}

/**
 * 感受会过期（默认 90 天），教训不过期。
 * 只在 block() 里每天顺手跑一次，失败不影响读取。
 */
const _lastPrune = new Map();
function prune({ dir = null, now = Date.now(), keepDays = 90 } = {}) {
  const day = today(now);
  const key = (dir || 'default') + '|' + day;
  if (_lastPrune.get(key)) return 0;
  _lastPrune.set(key, true);
  try {
    const cutoff = now - keepDays * 86400000;
    const keep = [];
    let dropped = 0;
    for (const line of readLines('feelings', dir)) {
      const m = LINE_RE.exec(line);
      if (!m) { keep.push(line); continue; }
      const [mm, dd] = m[1].split(' ')[0].split('-').map(Number);
      const [hh, mi] = m[1].split(' ')[1].split(':').map(Number);
      const d = new Date(new Date(now).getFullYear(), mm - 1, dd, hh, mi);
      if (d.getTime() > now) d.setFullYear(d.getFullYear() - 1);   // 跨年：未来日期按去年
      if (d.getTime() < cutoff) dropped += 1;
      else keep.push(line);
    }
    if (dropped) writeLines('feelings', dir, keep);
    return dropped;
  } catch { return 0; }
}

/** 人话列表：给「我写过什么」类标记用 */
function describe(kind, n = 6, { dir = null } = {}) {
  const list = recent(kind, n, { dir });
  if (!list.length) return '';
  return list.map((x) => `${x.at} ${x.status === 'confirmed' ? '' : '[' + x.status + '] '}${x.text}`).join('\n');
}

/** 解析一行（给睡眠任务用） */
function parseLine(line) {
  const m = LINE_RE.exec(line);
  if (!m) return null;
  return { at: m[1], status: m[2] || 'confirmed', text: m[3] };
}

/** 生成一条 `- [at] 正文`，按状态决定是否带标记 */
function formatLine(at, status, text) {
  const st = status === 'confirmed' ? '' : `(${status}) `;
  return `- [${at}] ${st}${text}`;
}

/** 改某一条的状态（按正文精确/包含匹配，只改第一条） */
function setStatus(kind, text, status, { dir = null } = {}) {
  const k = canon(kind);
  if (!k) return false;
  const target = String(text == null ? '' : text).trim();
  if (!target) return false;
  const lines = readLines(k, dir);
  let hit = false;
  const out = lines.map((line) => {
    if (hit) return line;
    const parsed = parseLine(line);
    if (!parsed) return line;
    if (parsed.text === target || parsed.text.includes(target) || target.includes(parsed.text)) {
      hit = true;
      return formatLine(parsed.at, ['pending', 'confirmed', 'archived'].includes(status) ? status : 'confirmed', parsed.text);
    }
    return line;
  });
  if (!hit) return false;
  return writeLines(k, dir, out);
}

/** 把 pending 超过 N 天的条目视为确认（M3 睡眠任务用） */
function promotePending({ kind = 'lessons', days = 7, now = Date.now(), dir = null } = {}) {
  const k = canon(kind);
  if (!k) return 0;
  const lines = readLines(k, dir);
  let promoted = 0;
  const out = lines.map((line) => {
    const parsed = parseLine(line);
    if (!parsed || parsed.status !== 'pending') return line;
    const [mm, dd] = parsed.at.split(' ')[0].split('-').map(Number);
    const [hh, mi] = parsed.at.split(' ')[1].split(':').map(Number);
    const d = new Date(new Date(now).getFullYear(), mm - 1, dd, hh, mi);
    if (d.getTime() > now) d.setFullYear(d.getFullYear() - 1);
    if (now - d.getTime() < days * 86400000) return line;
    promoted += 1;
    return formatLine(parsed.at, 'confirmed', parsed.text);
  });
  if (promoted) writeLines(k, dir, out);
  return promoted;
}

module.exports = { append, recent, block, consume, describe, prune, isDuplicate, setStatus, promotePending, parseLine, FILES, MAX_ENTRY, MAX_LINES };
