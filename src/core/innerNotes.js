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
const LINE_RE = /^- \[(\d{2}-\d{2} \d{2}:\d{2})\] (.*)$/;

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
function append(kind, text, { dir = null, now = Date.now() } = {}) {
  const k = canon(kind);
  if (!k) return { ok: false, kind };
  const body = String(text == null ? '' : text).replace(/\s+/g, ' ').trim().slice(0, MAX_ENTRY);
  if (!body) return { ok: false, kind };
  const file = fileOf(k, dir);
  if (!file) return { ok: false, kind: k };
  try {
    // appendFileSync 是单次 O_APPEND 写：并发消息不会互相覆盖（2026-11-22）
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, `- [${stamp(now)}] ${body}\n`, 'utf8');
    // 超过上限再压缩一次；不每写一条都重写整个文件
    const lines = readLines(k, dir);
    if (lines.length > MAX_LINES + 20) writeLines(k, dir, lines);
    return { ok: true, kind: k };
  } catch (err) {
    return { ok: false, kind: k };
  }
}

/** 最近 n 条（旧→新）。 */
function recent(kind, n = 2, { dir = null } = {}) {
  const out = [];
  for (const line of readLines(kind, dir)) {
    const m = LINE_RE.exec(line);
    if (m) out.push({ at: m[1], text: m[2] });
  }
  return out.slice(-Math.max(1, Math.min(20, n)));
}

/** 给提示词的一段；没有记录就返回空串。 */
function block({ dir = null, limit = 2 } = {}) {
  const feelings = recent('feelings', limit, { dir });
  const lessons = recent('lessons', limit, { dir });
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

/** 人话列表：给「我写过什么」类标记用 */
function describe(kind, n = 6, { dir = null } = {}) {
  const list = recent(kind, n, { dir });
  if (!list.length) return '';
  return list.map((x) => `${x.at} ${x.text}`).join('\n');
}

module.exports = { append, recent, block, consume, describe, FILES, MAX_ENTRY, MAX_LINES };
