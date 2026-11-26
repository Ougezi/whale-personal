'use strict';
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const P = require('../../src/core/expressionPrefs.js');
let p = 0, f = 0;
function c(n, fn) { try { fn(); p++; console.log('  ✓ ' + n); } catch (e) { f++; console.log('  ✗ ' + n + ' ' + e.message); } }
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-pref-'));
c('不喜欢水滴 → 禁 💧', () => assert.ok(P.learn(dir, '我不喜欢水滴').bannedEmojis.includes('💧')));
c('少发 💧 → 禁 💧', () => assert.ok(P.learn(dir, '少发💧').bannedEmojis.includes('💧')));
c('过滤文本', () => assert.strictEqual(P.filterText('好💧', ['💧']), '好'));
c('其他 emoji 保留', () => assert.strictEqual(P.filterText('好🐋', ['💧']), '好🐋'));
c('可以发了 → 解除', () => assert.ok(!P.learn(dir, '可以发💧了').bannedEmojis.includes('💧')));
c('prompt 有偏好', () => { P.learn(dir, '我不喜欢💧'); assert.ok(P.line(dir).includes('💧')); });
console.log('\n通过 ' + p + '/' + (p + f));
process.exit(f ? 1 : 0);
