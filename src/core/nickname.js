// 改称呼识别（2026-11-24）：主人说「以后叫你 X / 不叫你 X」时给她一条明确提示
'use strict';

const CALL_RE = /以后(?:就|都|只)?(?:叫你|喊你|称呼你)\s*([\u4e00-\u9fa5A-Za-z0-9_]{1,8})/;
const STOP_RE = /以后不叫你|别再叫我|不许叫我/;

function extract(text) {
  const s = String(text == null ? '' : text);
  const m = CALL_RE.exec(s);
  if (m) {
    // 「鲸鲸吧」「鲸鲸呀」里的语气词不属于名字
    const name = m[1].replace(/[吧呀啊哦嘛呢哈啦]+$/, '').trim();
    if (name) return { action: 'call', name };
  }
  if (STOP_RE.test(s)) return { action: 'stop', name: '' };
  return null;
}

function hint(text) {
  const hit = extract(text);
  if (hit && hit.action === 'call') return `【改称呼】主人以后要叫你「${hit.name}」；直接接受并记住，不要反问“我该叫什么”。`;
  if (hit && hit.action === 'stop') return '【改称呼】主人不想再叫某个名字了；顺着接受，别追问“那我该叫什么”。';
  return '';
}

/* ---- 持久化：data/nicknames.json ---- */
const MAX_CHATS = 200;

function fileOf(dataDir) { return require('node:path').join(dataDir, 'nicknames.json'); }

function remember(dataDir, chatId, text, now = Date.now()) {
  const hit = extract(text);
  if (!dataDir || !chatId || !hit || hit.action !== 'call') return null;
  const fs = require('node:fs');
  const path = require('node:path');
  let data = {};
  try { data = JSON.parse(fs.readFileSync(fileOf(dataDir), 'utf8')) || {}; } catch { data = {}; }
  data[String(chatId)] = { name: hit.name, at: now };
  // 只保留最近 200 个会话，避免 nicknames.json 无限长大
  const keys = Object.keys(data);
  if (keys.length > MAX_CHATS) {
    keys.sort((a, b) => (Number(data[b].at) || 0) - (Number(data[a].at) || 0));
    for (const k of keys.slice(MAX_CHATS)) delete data[k];
  }
  try {
    fs.mkdirSync(path.dirname(fileOf(dataDir)), { recursive: true });
    const tmp = fileOf(dataDir) + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data, null, 1), 'utf8');
    fs.renameSync(tmp, fileOf(dataDir));
  } catch { return null; }
  return hit.name;
}

function current(dataDir, chatId) {
  if (!dataDir || !chatId) return '';
  try {
    const data = JSON.parse(require('node:fs').readFileSync(fileOf(dataDir), 'utf8'));
    const hit = data && data[String(chatId)];
    return hit && hit.name ? String(hit.name) : '';
  } catch { return ''; }
}

module.exports = { hint, extract, remember, current, CALL_RE, STOP_RE };
