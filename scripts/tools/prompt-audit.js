'use strict';
// 提示词测绘：离线拼一份 system（不联网、不发请求），按【块】统字符/token，并列出重复块。
// 用法：node scripts/tools/prompt-audit.js [--json]
const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.resolve(__dirname, '..', '..');
const DATA = process.env.WHALE_DATA || path.join(ROOT, 'data');
// 便携版数据在 dist/whale-personal/data；源码仓库没有 data 时退到环境变量
const dataDir = fs.existsSync(DATA) ? DATA : path.join(ROOT, 'dist', 'whale-personal', 'data');

function loadJson(p) { try { return JSON.parse(fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, '')); } catch { return null; } }

const config = loadJson(path.join(dataDir, 'config.json')) || {};
const personaFile = loadJson(path.join(dataDir, 'persona.json')) || {};
config.paths = { dataDir, root: path.resolve(dataDir, '..') };
// 和启动时一样：persona.json 的人设字段盖到 config.persona 上（只取人设本身）
config.persona = Object.assign({}, config.persona || {});
for (const k of ['name', 'age', 'job', 'appearance', 'personality', 'background', 'customPrompt',
  'emoji', 'proactive', 'opinions', 'quirks', 'taboos', 'selfRefs', 'relationship', 'newBehavior']) {
  if (personaFile[k] !== undefined) config.persona[k] = personaFile[k];
}

const persona = require(path.join(ROOT, 'src', 'persona'));
const now = new Date();
const msg = {
  platform: 'wechat', chatType: 'private', senderName: '主人', chatId: 'u1',
  isMaster: true, cleanText: '你好', text: '你好', ts: now.getTime(),
};
const parts = persona.buildPromptParts({
  config, msg, profile: { count: 3 }, notes: [], noteReminders: [], sessionSummary: '',
  events: [], now, moodLine: '', selfRules: '',
});
const system = String(parts.system || '');
const blocks = {};
const re = /【([^】]{2,14})】/g;
let m;
const marks = [];
while ((m = re.exec(system))) marks.push({ name: m[1], at: m.index });
for (let i = 0; i < marks.length; i += 1) {
  const start = marks[i].at;
  const end = i + 1 < marks.length ? marks[i + 1].at : system.length;
  const text = system.slice(start, end);
  blocks[marks[i].name] = (blocks[marks[i].name] || 0) + text.length;
}
const dup = Object.entries(blocks).filter(([, v]) => v > 0 && marks.filter((x) => x.name === Object.keys(blocks).find((k) => blocks[k] === v)).length > 1);
const counts = {};
for (const x of marks) counts[x.name] = (counts[x.name] || 0) + 1;
const duplicated = Object.entries(counts).filter(([, n]) => n > 1);
const chars = system.length;
const tokens = Math.round(chars * 0.65);
const result = { systemChars: chars, estimatedTokens: tokens, blocks: marks.length, duplicated, blockChars: blocks };
if (process.argv.includes('--json')) console.log(JSON.stringify(result, null, 1));
else {
  console.log('systemChars=' + chars + '  estimatedTokens=' + tokens + '  blocks=' + marks.length);
  console.log('重复块：' + (duplicated.length ? duplicated.map(([k, n]) => k + '×' + n).join('、') : '无'));
  console.log('最大的 12 个块（字符）：');
  for (const [k, v] of Object.entries(blocks).sort((a, b) => b[1] - a[1]).slice(0, 12)) console.log('  ' + v + '\t' + k);
}
