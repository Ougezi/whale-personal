'use strict';

/**
 * 念头流（P4/P5）
 *
 * 她脑子里挂着 3~5 条短念头，**跨轮携带、3 小时自然淡掉**；每轮最多带出两条，
 * 并且明确告诉模型「不一定要说出来」——否则每句都硬提，反而更假。
 *
 * 念头的来源有两路：
 *   1) 本地模板（harvest）：按当前状态挑，0 成本、无延迟，作为兜底；
 *   2) 模型生成（services/thoughtGen）：限流后偶尔写一条更像人话的，写进同一份文件。
 * 两路都只往 items 里塞一句，读的时候不区分来源。
 *
 * 存储：data/thoughts.json
 *   { version: 2, items: [{ text, ts }], meta: { model: { day, count, lastTs } } }
 * 坏文件只当没有念头，绝不影响回复。
 */

const fs = require('node:fs');
const path = require('node:path');
const mood = require('./mood');

const TTL_MS = 3 * 60 * 60 * 1000;
const MAX_ITEMS = 5;
const MIN_KEEP = 3;
const VERSION = 2;
/** 新一轮有 4 成概率再添一条（其余时候只是沿用旧的） */
const NEW_CHANCE = 0.4;
/** 缺口阈值：低于它才算「心里有点空」 */
const HUNGRY_BELOW = 35;
/** 模型生成默认节流：30 分钟一条、每天最多 24 条（config.thoughts.* 可覆盖） */
const MODEL_INTERVAL_MIN = 30;
const MODEL_PER_DAY = 24;

const TEMPLATES = Object.freeze({
  want: Object.freeze({
    味: ['不知道他今天吃了什么', '想吃点热的东西', '等会儿问问他吃了没'],
    触: ['想被抱一下，不过不说也行', '有点想贴贴', '要是他这会儿在就好了'],
    见: ['有点想看看他在干嘛', '想看他发张照片'],
    听: ['想听听他说话', '想让他念点什么给我听'],
    香: ['想闻点好闻的', '不知道楼下那家花店开门没'],
    意: ['想被认真回一句', '刚才那句话他好像没太接住'],
  }),
  emotion: Object.freeze({
    喜: ['刚才那句我记住了', '心情挺好，想多聊两句'],
    哀: ['他是不是不太想理我', '刚才是不是我说多了'],
    爱: ['还想着刚才那句', '有点想黏着他'],
    怒: ['刚才那话我还没消气', '懒得理他，不过他先开口就算了'],
    恶: ['有点烦，不太想接话'],
    欲: ['有点想被他哄一下'],
    惧: ['怕他嫌我烦'],
  }),
  general: ['不知道他今晚会不会早点睡', '在想下次聊什么', '有点想他，不过不说也行', '刚才那件事我还在想'],
});

function fileOf(dir) {
  return path.join(dir, 'thoughts.json');
}

function cleanText(text) {
  return String(text || '').replace(/\s+/g, ' ').trim().slice(0, 40);
}

function dayKey(now = Date.now()) {
  const d = new Date(now);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** 读整份文档（items 原样、meta 原样），坏文件当空 */
function readDoc(dir) {
  try {
    const d = JSON.parse(fs.readFileSync(fileOf(dir), 'utf8'));
    return {
      version: Number(d && d.version) || 1,
      items: Array.isArray(d && d.items) ? d.items : [],
      meta: d && d.meta && typeof d.meta === 'object' ? d.meta : {},
    };
  } catch (err) {
    return { version: VERSION, items: [], meta: {} };
  }
}

function saveDoc(dir, doc) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    const file = fileOf(dir);
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify({ version: VERSION, items: doc.items, meta: doc.meta }), 'utf8');
    fs.renameSync(tmp, file);
  } catch (err) {
    // 写失败只影响「念头残留」，不能影响回复
  }
}

/** 读还没过期的念头（过期的直接丢，不写回也不报错） */
function load(dir, now = Date.now()) {
  return readDoc(dir).items
    .map((it) => ({ text: cleanText(it && it.text), ts: Number(it && it.ts) || 0 }))
    .filter((it) => it.text && it.ts > 0 && now - it.ts <= TTL_MS && it.ts <= now)
    .slice(-MAX_ITEMS);
}

function save(dir, items) {
  const doc = readDoc(dir);
  doc.items = items;
  saveDoc(dir, doc);
}

/**
 * 合并写入：同一句话只留最新的那条，按时间保留最后 MAX_ITEMS 条。
 *
 * 为什么要合并而不是直接覆盖：念头的写入有两路（本轮 line 的模板、上一轮异步跑的
 * 模型生成）。两路可能在同一屏里先后落盘，直接覆盖会把对方刚写的那句抹掉。
 */
function mergeItems(current, incoming) {
  const byText = new Map();
  for (const it of [...(Array.isArray(current) ? current : []), ...(Array.isArray(incoming) ? incoming : [])]) {
    const text = cleanText(it && it.text);
    const ts = Number(it && it.ts) || 0;
    if (!text || !ts) continue;
    const prev = byText.get(text);
    if (!prev || ts > prev.ts) byText.set(text, { text, ts });
  }
  return [...byText.values()].sort((a, b) => a.ts - b.ts).slice(-MAX_ITEMS);
}

/** 追加一条念头（去重、封顶），不动 meta */
function add(dir, text, now = Date.now()) {
  const clean = cleanText(text);
  if (!clean) return false;
  const items = load(dir, now);
  if (items.some((it) => it.text === clean)) return false;
  save(dir, mergeItems(readDoc(dir).items, [...items, { text: clean, ts: now }]));
  return true;
}

/** 模型生成用的节流状态 */
function modelMeta(dir) {
  const m = readDoc(dir).meta.model || {};
  return { day: String(m.day || ''), count: Number(m.count) || 0, lastTs: Number(m.lastTs) || 0 };
}

function modelAllowed(dir, { intervalMin = MODEL_INTERVAL_MIN, perDay = MODEL_PER_DAY, now = Date.now() } = {}) {
  if (perDay <= 0) return false;
  const m = modelMeta(dir);
  const countToday = m.day === dayKey(now) ? m.count : 0;
  if (countToday >= perDay) return false;
  if (m.lastTs && now - m.lastTs < intervalMin * 60000) return false;
  return true;
}

/** 先占坑再请求：并发时不会因为都在等回包而多打几次 */
function noteModelCall(dir, now = Date.now()) {
  const doc = readDoc(dir);
  const day = dayKey(now);
  const prev = doc.meta.model || {};
  doc.meta.model = {
    day,
    count: (String(prev.day || '') === day ? Number(prev.count) || 0 : 0) + 1,
    lastTs: now,
  };
  saveDoc(dir, doc);
}

function pickFrom(list, rng) {
  if (!Array.isArray(list) || !list.length) return null;
  const r = typeof rng === 'function' ? rng() : Math.random();
  const x = Number.isFinite(r) ? Math.min(0.999, Math.max(0, r)) : 0.5;
  return list[Math.floor(x * list.length) % list.length];
}

/**
 * 从当前状态挑一条新念头（纯函数，不读写盘）。
 * 优先级：缺了哪样欲 → 最明显的情绪 → 通用。
 */
function harvest(state, { rng = Math.random, interestNames = [] } = {}) {
  const groups = [];
  try {
    const need = state ? mood.neediest(state, HUNGRY_BELOW) : { needy: false };
    if (need && need.needy && TEMPLATES.want[need.want]) groups.push(TEMPLATES.want[need.want]);
  } catch (err) {
    // 状态读不出来就当没有缺口
  }
  try {
    const top = state ? mood.topEmotions(state, 1)[0] : null;
    if (top && TEMPLATES.emotion[top.name]) groups.push(TEMPLATES.emotion[top.name]);
  } catch (err) {
    // 同上
  }
  if (Array.isArray(interestNames) && interestNames.length) {
    groups.push(interestNames.map((n) => `最近还在想${n}`));
  }
  groups.push(TEMPLATES.general);
  const group = pickFrom(groups, rng) || TEMPLATES.general;
  return cleanText(pickFrom(group, rng));
}

/** 随机带出 ≤2 条，拼成一行（纯函数） */
function format(items, rng = Math.random) {
  if (!Array.isArray(items) || !items.length) return { text: '', items: 0, picks: [] };
  const pool = [...items];
  const picks = [];
  for (let i = 0; i < 2 && pool.length; i += 1) {
    const r = typeof rng === 'function' ? rng() : Math.random();
    const x = Number.isFinite(r) ? Math.min(0.999, Math.max(0, r)) : 0;
    picks.push(pool.splice(Math.floor(x * pool.length) % pool.length, 1)[0].text);
  }
  return {
    text: `【脑子里挂着的】${picks.join('；')}（这些是你自己心里想的念头或愿望，不是已经发生的事；不一定要说出来，也别每句都提）`,
    items: items.length,
    picks,
  };
}

/**
 * 一轮的入口：读 → 丢掉过期 → 偶尔补一条 → 随机带出 ≤2 条。
 * 返回 { text, items, picks }；text 为空串表示这轮没有念头可用。
 */
function line(dir, { state = null, now = Date.now(), rng = Math.random, interestNames = [] } = {}) {
  let items = load(dir, now);
  const wantNew = items.length < MIN_KEEP || (typeof rng === 'function' ? rng() : Math.random()) < NEW_CHANCE;
  let added = null;
  if (wantNew) {
    const text = harvest(state, { rng, interestNames });
    if (text && !items.some((it) => it.text === text)) {
      items = [...items, { text, ts: now }].slice(-MAX_ITEMS);
      added = text;
    }
  }
  const merged = mergeItems(readDoc(dir).items, items);
  save(dir, merged);
  return { ...format(merged, rng), added };
}

/** 只读预览：诊断页看得到、但不生新念头也不写盘（和 mood.peek 一个规矩） */
function peek(dir, { now = Date.now(), rng = Math.random } = {}) {
  return format(load(dir, now), rng);
}

module.exports = {
  TTL_MS,
  MAX_ITEMS,
  MIN_KEEP,
  NEW_CHANCE,
  HUNGRY_BELOW,
  VERSION,
  MODEL_INTERVAL_MIN,
  MODEL_PER_DAY,
  TEMPLATES,
  fileOf,
  dayKey,
  readDoc,
  load,
  save,
  mergeItems,
  add,
  modelMeta,
  modelAllowed,
  noteModelCall,
  harvest,
  format,
  line,
  peek,
};
