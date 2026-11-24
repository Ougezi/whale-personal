'use strict';
/** I-25：从真实历史 messages.jsonl 取样，喂给 personaShadow，不调用模型。 */
const fs = require('node:fs');
const path = require('node:path');
const { observe } = require('../../src/services/personaShadow.js');

function pairsFrom(file, limit = 20) {
  const rows = [];
  try {
    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
      if (!line.trim()) continue;
      try { rows.push(JSON.parse(line)); } catch { /* skip */ }
    }
  } catch { return []; }
  const out = [];
  for (let i = 0; i < rows.length && out.length < limit; i++) {
    const u = rows[i];
    if (!u || u.role !== 'user' || !u.text) continue;
    const a = rows.slice(i + 1).find((x) => x && x.role === 'assistant' && x.text);
    if (!a) continue;
    out.push({ text: u.text, reply: a.text });
  }
  return out;
}

function main() {
  const root = process.cwd();
  const dataDir = path.join(root, 'data');
  const chatsDir = path.join(dataDir, 'memory', 'chats');
  const limit = Number(process.argv[2]) || 20;
  let made = 0;
  const files = fs.existsSync(chatsDir) ? fs.readdirSync(chatsDir) : [];
  for (const chat of files) {
    const dir = path.join(chatsDir, chat);
    if (!fs.statSync(dir).isDirectory()) continue;
    const metaPath = path.join(dir, 'meta.json');
    let meta = {};
    try { meta = JSON.parse(fs.readFileSync(metaPath, 'utf8')); } catch { /* ignore */ }
    const file = path.join(dir, 'messages.jsonl');
    if (!fs.existsSync(file)) continue;
    for (const p of pairsFrom(file, limit - made)) {
      observe({ dataDir, chatId: meta.chatId || chat, chatType: meta.chatType || 'private',
        senderId: meta.ownerId || '', text: p.text, reply: p.reply, now: Date.now() - (limit - made) * 1000 });
      made += 1;
      if (made >= limit) break;
    }
    if (made >= limit) break;
  }
  console.log('shadow samples added:', made);
  return made > 0 ? 0 : 1;
}
if (require.main === module) process.exit(main());
module.exports = { pairsFrom, main };
