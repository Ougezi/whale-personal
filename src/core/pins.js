// 关键事实 pin（第三期，2026-11-24）：约定、雷点这类不能忘的事
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const MAX_PINS = 20;

function fileOf(dataDir) { return path.join(dataDir, 'pins.json'); }
function load(dataDir) {
  try {
    const d = JSON.parse(fs.readFileSync(fileOf(dataDir), 'utf8'));
    if (d && typeof d === 'object') return d;
  } catch { /* 首次 */ }
  return {};
}
function save(dataDir, data) {
  try {
    fs.mkdirSync(path.dirname(fileOf(dataDir)), { recursive: true });
    const tmp = fileOf(dataDir) + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data, null, 1), 'utf8');
    fs.renameSync(tmp, fileOf(dataDir));
    return true;
  } catch { return false; }
}

/** 从一句话识别该 pin 的事（约定 / 雷点） */
function detect(text) {
  const s = String(text == null ? '' : text);
  const out = [];
  const promise = /(说好|约好|以后每[天周月]|每周[一二三四五六日天]|每天|每月|每年)[^，,。；;]{1,40}/.exec(s);
  if (promise) out.push({ kind: '约定', text: promise[0].trim().slice(0, 60) });
  const taboo = /(雷点|忌讳|别提|不准提|不要提|别问|不要问)[^，,。；;]{0,40}/.exec(s);
  if (taboo) out.push({ kind: '雷点', text: taboo[0].trim().slice(0, 60) });
  return out;
}

function add(dataDir, chatId, items, now = Date.now()) {
  if (!dataDir || !chatId || !Array.isArray(items) || !items.length) return 0;
  const data = load(dataDir);
  const key = String(chatId);
  const list = Array.isArray(data[key]) ? data[key] : [];
  let added = 0;
  for (const it of items) {
    const text = String(it && it.text || '').trim();
    if (!text) continue;
    if (list.some((x) => x.text === text)) continue;
    list.push({ kind: String(it.kind || '备注'), text, at: now });
    added += 1;
  }
  data[key] = list.slice(-MAX_PINS);
  if (added) save(dataDir, data);
  return added;
}

function list(dataDir, chatId, limit = 5) {
  const data = load(dataDir);
  const arr = Array.isArray(data[String(chatId)]) ? data[String(chatId)] : [];
  return arr.slice(-Math.max(1, Math.min(MAX_PINS, limit)));
}

function block({ dataDir = null, chatId = '', limit = 3 } = {}) {
  const items = list(dataDir, chatId, limit);
  if (!items.length) return '';
  return '【记着的】' + items.map((x) => `${x.kind}：${x.text}`).join('；');
}

module.exports = { detect, add, list, block, MAX_PINS };
