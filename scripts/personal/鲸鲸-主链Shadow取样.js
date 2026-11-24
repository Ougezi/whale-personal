'use strict';
/** I-25：从真实历史 messages.jsonl 取样，优先情绪信号/技术 literal/群聊。 */
const fs = require('node:fs');
const path = require('node:path');
const { observe } = require('../../src/services/personaShadow.js');

const SIGNAL = /好乖|厉害|谢谢|辛苦|爱你|喜欢|可爱|笨|烦|讨厌|气死|滚|么么|抱抱|亲亲|烦死|无语/;
const TECH = /[A-Za-z]:\\|```|v?\d+\.\d+\.\d+|API_KEY|sk-[A-Za-z0-9]|\.py\b|\.js\b|\.json\b/;

function pairsFrom(file) {
  const rows = [];
  try {
    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
      if (!line.trim()) continue;
      try { rows.push(JSON.parse(line)); } catch { /* skip */ }
    }
  } catch { return []; }
  const out = [];
  for (let i = 0; i < rows.length; i++) {
    const u = rows[i];
    if (!u || u.role !== 'user' || !u.text) continue;
    const a = rows.slice(i + 1).find((x) => x && x.role === 'assistant' && x.text);
    if (!a) continue;
    out.push({ text: u.text, reply: a.text, at: Number(u.ts) || 0 });
  }
  return out;
}

function score(p) {
  return (SIGNAL.test(p.text) ? 3 : 0) + (TECH.test(p.reply) ? 3 : 0) + (p.at ? 1 : 0);
}

function main() {
  const root = process.cwd();
  const dataDir = path.join(root, 'data');
  const chatsDir = path.join(dataDir, 'memory', 'chats');
  const limit = Number(process.argv[2]) || 20;
  const all = [];
  const files = fs.existsSync(chatsDir) ? fs.readdirSync(chatsDir) : [];
  for (const chat of files) {
    const dir = path.join(chatsDir, chat);
    if (!fs.statSync(dir).isDirectory()) continue;
    let meta = {};
    try { meta = JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8')); } catch { /* ignore */ }
    const file = path.join(dir, 'messages.jsonl');
    if (!fs.existsSync(file)) continue;
    for (const p of pairsFrom(file)) all.push({ ...p, chatId: meta.chatId || chat, chatType: meta.chatType || 'private', senderId: meta.ownerId || '' });
  }
  all.sort((a, b) => score(b) - score(a) || b.at - a.at);
  const picked = all.slice(0, limit);
  for (const p of picked) {
    observe({ dataDir, chatId: p.chatId, chatType: p.chatType, senderId: p.senderId,
      text: p.text, reply: p.reply, now: Date.now() - limit * 1000 + picked.indexOf(p) });
  }
  const sig = picked.filter((p) => SIGNAL.test(p.text)).length;
  const tech = picked.filter((p) => TECH.test(p.reply)).length;
  console.log('shadow samples added:', picked.length, 'signal:', sig, 'tech:', tech);
  return picked.length > 0 ? 0 : 1;
}
if (require.main === module) process.exit(main());
module.exports = { pairsFrom, score, main };
