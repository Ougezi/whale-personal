'use strict';
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const F = require('../../src/core/feedbackLedger.js');
let p = 0, f = 0;
function c(n, fn) { try { fn(); p++; console.log('  ✓ ' + n); } catch (e) { f++; console.log('  ✗ ' + n + ' ' + e.message); } }
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-fb-'));
c('无反馈不记', () => assert.strictEqual(F.record(dir, { text: '今天吃什么' }).ok, false));
c('ban 记录', () => { const r = F.record(dir, { text: '我不喜欢💧', chat: 'c1' }); assert.strictEqual(r.mode, 'ban'); });
c('reduce 记录', () => { const r = F.record(dir, { text: '少发💧', chat: 'c1' }); assert.strictEqual(r.mode, 'reduce'); });
c('allow 记录', () => { const r = F.record(dir, { text: '可以发💧了', chat: 'c1' }); assert.strictEqual(r.mode, 'allow'); });
c('jsonl 追加', () => assert.ok(fs.readFileSync(path.join(dir, 'self', 'feedback.jsonl'), 'utf8').includes('allow')));
c('preferences 落盘', () => assert.ok(fs.existsSync(path.join(dir, 'self', 'preferences.json'))));
console.log('\n通过 ' + p + '/' + (p + f));
process.exit(f ? 1 : 0);
