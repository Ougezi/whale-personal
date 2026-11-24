'use strict';

/**
 * 写操作总闸（点赞/收藏）的读写与「主人一句话开关」解析。
 *
 * 面板、微信、sidecar 共用同一个落盘文件：`<whale-douyin>/state/ops.json`。
 * 规则：
 *  - 默认全关；
 *  - 关总闸时把两个分项一起关，避免「开关看着开、实际不生效」；
 *  - 只允许主人私聊改（调用方保证），群里谁喊都不动账号。
 */

const fs = require('node:fs');
const path = require('node:path');

const DIR = process.env.WHALE_DOUYIN_DIR || 'D:\\dsh\\profiles\\desktop\\whale-douyin';

function opsFile() {
  return path.join(DIR, 'state', 'ops.json');
}

function read() {
  try {
    const j = JSON.parse(fs.readFileSync(opsFile(), 'utf8'));
    return {
      enableOps: Boolean(j.enableOps),
      allowLike: Boolean(j.allowLike),
      allowCollect: Boolean(j.allowCollect),
      dailyWriteActions: Math.max(0, Math.min(20, Number(j.dailyWriteActions) || 0)),
    };
  } catch {
    return { enableOps: false, allowLike: false, allowCollect: false, dailyWriteActions: 0 };
  }
}

function write(next) {
  const cur = read();
  const merged = {
    enableOps: next.enableOps == null ? cur.enableOps : Boolean(next.enableOps),
    allowLike: next.allowLike == null ? cur.allowLike : Boolean(next.allowLike),
    allowCollect: next.allowCollect == null ? cur.allowCollect : Boolean(next.allowCollect),
    dailyWriteActions: next.dailyWriteActions == null ? cur.dailyWriteActions
      : Math.max(0, Math.min(20, Number(next.dailyWriteActions) || 0)),
  };
  if (!merged.enableOps) {
    merged.allowLike = false;
    merged.allowCollect = false;
  }
  const file = opsFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(merged, null, 1), 'utf8');
  fs.renameSync(tmp, file);
  return merged;
}

const NUM = /(?:每天|一天|每日)\s*(?:最多)?\s*(\d{1,2})\s*次/;

/** 解析主人的一句话（可能一句里好几件事）；不认识的返回 null */
function parse(text) {
  const t = String(text || '');
  if (!t) return null;
  const intents = [];
  const num = NUM.exec(t);
  if (num) intents.push({ type: 'daily', value: Number(num[1]) });
  if (/(关闭|关掉|禁止|停用|暂停|别).{0,3}写操作/.test(t)) intents.push({ type: 'off' });
  else if (/(开启|打开|允许|可以).{0,3}写操作/.test(t)) intents.push({ type: 'on' });
  if (/(禁止|不许|不要|关掉|关闭).{0,3}点赞/.test(t)) intents.push({ type: 'nolike' });
  else if (/(允许|可以|开).{0,3}点赞/.test(t)) intents.push({ type: 'like' });
  if (/(禁止|不许|不要|关掉|关闭).{0,3}收藏/.test(t)) intents.push({ type: 'nocollect' });
  else if (/(允许|可以|开).{0,3}收藏/.test(t)) intents.push({ type: 'collect' });
  if (!intents.length) return null;
  return { intents };
}

const LABEL = {
  on: '写操作开关已打开（默认还是关着，随时可以关）',
  off: '写操作已关，点赞/收藏都不会动',
  like: '允许点赞了（每次仍要写预算够）',
  nolike: '点赞已禁止',
  collect: '允许收藏了',
  nocollect: '收藏已禁止',
  daily: '每日写操作次数已设置',
};

/** 执行开关 intent（可能一句多条），返回 { state, reply } */
function apply(parsed) {
  const list = parsed && Array.isArray(parsed.intents) ? parsed.intents : [parsed];
  let next = null;
  const lines = [];
  for (const intent of list) {
    if (intent.type === 'on') next = write({ enableOps: true });
    else if (intent.type === 'off') next = write({ enableOps: false });
    else if (intent.type === 'like') next = write({ enableOps: true, allowLike: true });
    else if (intent.type === 'nolike') next = write({ allowLike: false });
    else if (intent.type === 'collect') next = write({ enableOps: true, allowCollect: true });
    else if (intent.type === 'nocollect') next = write({ allowCollect: false });
    else if (intent.type === 'daily') next = write({ dailyWriteActions: intent.value });
    else continue;
    lines.push(LABEL[intent.type]);
  }
  if (!next) return null;
  const line = '现在：写操作' + (next.enableOps ? '开' : '关')
    + '，点赞' + (next.allowLike ? '开' : '关')
    + '，收藏' + (next.allowCollect ? '开' : '关')
    + '，每天最多 ' + next.dailyWriteActions + ' 次';
  return { state: next, reply: lines.join('；') + '；' + line };
}

/** 回复里的标记 [[ops:on|off|like|nolike|collect|nocollect|daily 3]] */
function stripMarkers(text) {
  const re = /\[\[ops[:：]\s*([^\]]*?)\s*\]\]/gi;
  const intents = [];
  const clean = String(text || '').replace(re, (_, body) => {
    const b = String(body || '').trim().toLowerCase();
    if (b === 'on' || b === 'off') intents.push({ type: b });
    else if (b === 'like' || b === 'nolike' || b === 'collect' || b === 'nocollect') intents.push({ type: b });
    else {
      const m = b.match(/^daily\s+(\d{1,2})$/);
      if (m) intents.push({ type: 'daily', value: Number(m[1]) });
    }
    return '';
  }).trim();
  return { text: clean, intents };
}

module.exports = { opsFile, read, write, parse, apply, stripMarkers };
