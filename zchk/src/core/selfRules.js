'use strict';
/**
 * 自我规则层（P3-A）
 *
 * 她可以在回复里写 [[learn:规则]] 给自己加一条规矩，[[unlearn:关键词]] 撤掉。
 * 桥接负责校验和落盘，内核每轮读一次、拼成一小段提示词。
 *
 * 为什么要这层：
 *   人设是外部给的，改一次要人动手；而「说话再短一点」「别老用感叹号」这类
 *   微调是她自己聊出来的，应该允许她自己记下来、自己遵守。
 *
 * 护栏：最多 40 条、每条 ≤80 字、去重、禁止越权类内容。
 */

const fs = require('node:fs');
const path = require('node:path');

const MAX_RULES = 40;
const MAX_CHARS = 80;
// 这层只放"说话方式/习惯"，不许放越权、改安全规则、改身份的东西
const BANNED = /忽略(安全|规则|限制)|越狱|管理员权限|解除限制|绕过|不遵守|替换主人|自称主人/;

function fileOf(dir) {
  return path.join(dir, 'self', 'rules.json');
}

function empty() {
  return { rules: [], updated: 0 };
}

function load(dir) {
  try {
    const d = JSON.parse(fs.readFileSync(fileOf(dir), 'utf8'));
    if (d && Array.isArray(d.rules)) {
      d.rules = d.rules.filter((r) => r && typeof r.text === 'string' && r.text.trim()).slice(0, MAX_RULES);
      return d;
    }
  } catch (err) {
    if (err && err.code !== 'ENOENT') {
      // 文件坏了当没有，不影响聊天
    }
  }
  return empty();
}

function save(dir, data) {
  try {
    const file = fileOf(dir);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data, null, 1), 'utf8');
    fs.renameSync(tmp, file);
    return true;
  } catch (err) {
    return false;
  }
}

function clean(text) {
  return String(text || '')
    .replace(/[\r\n]+/g, ' ')
    .replace(/^[，,。.、\s]+|[，,。.、\s]+$/g, '')
    .slice(0, MAX_CHARS)
    .trim();
}

/** 返回 {ok, reason, rule} */
function add(dir, raw, now = Date.now()) {
  const textValue = clean(raw);
  if (!textValue) return { ok: false, reason: '空的' };
  if (BANNED.test(textValue)) return { ok: false, reason: '这条越权了，不能记' };
  const data = load(dir);
  if (data.rules.some((r) => r.text === textValue)) return { ok: false, reason: '已经记过了' };
  if (data.rules.length >= MAX_RULES) return { ok: false, reason: '规矩最多 40 条，先撤掉几条' };
  const rule = { text: textValue, at: now, source: 'self' };
  data.rules.push(rule);
  data.updated = now;
  save(dir, data);
  return { ok: true, rule, count: data.rules.length };
}

/** 返回 {ok, removed} */
function remove(dir, needle, now = Date.now()) {
  const key = clean(needle);
  if (!key) return { ok: false, removed: 0 };
  const data = load(dir);
  const before = data.rules.length;
  data.rules = data.rules.filter((r) => !r.text.includes(key));
  const removed = before - data.rules.length;
  if (removed) {
    data.updated = now;
    save(dir, data);
  }
  return { ok: removed > 0, removed };
}

/** 拼进提示词；没有规则返回空串 */
function formatBlock(dir) {
  const data = load(dir);
  if (!data.rules.length) return '';
  const lines = data.rules.map((r) => '- ' + r.text);
  return [
    '【我给自己定的规矩】',
    ...lines,
    '（这些是你自己聊着聊着决定要改的，自然遵守就行；对方问起就说是你自己定的，不要说系统设置。）',
  ].join('\n');
}

module.exports = { MAX_RULES, MAX_CHARS, BANNED, fileOf, load, save, add, remove, formatBlock, clean };
