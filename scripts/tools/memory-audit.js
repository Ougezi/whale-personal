'use strict';
// 记忆体检（M4）：node scripts/tools/memory-audit.js [--json]
const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.resolve(__dirname, '..', '..');
const DATA = process.env.WHALE_DATA || path.join(ROOT, 'dist', 'whale-personal', 'data');
const inspect = require(path.join(ROOT, 'src', 'memory', 'inspect.js'));

if (!fs.existsSync(path.join(DATA, 'memory', 'chats'))) {
  console.log(JSON.stringify({ ok: true, skipped: '没有运行数据' }));
  process.exit(0);
}
const report = inspect.scan({ dataDir: DATA });
if (process.argv.includes('--json')) console.log(JSON.stringify(report, null, 1));
else {
  console.log('记忆体检：卡片 ' + report.cards + ' / 事件 ' + report.events);
  console.log('重复 ' + report.dups + '，无来源(新) ' + report.noSource + '，旧数据缺来源 ' + report.legacyNoSource
    + '，坏卡 ' + report.broken + '，超限 ' + report.overLimit);
  console.log(report.ok ? '体检通过' : '体检失败');
}
process.exit(report.ok ? 0 : 1);
