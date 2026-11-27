'use strict';
const assert = require('node:assert');
const S = require('../../src/adapters/stickers.js');
let p = 0, f = 0;
function c(n, fn) { try { fn(); p++; console.log('  ✓ ' + n); } catch (e) { f++; console.log('  ✗ ' + n + ' ' + e.message); } }
c('未请求默认拒绝', () => assert.strictEqual(S.shouldSendSticker({ onlyOnRequest: true, demanded: false }), false));
c('明确请求放行', () => assert.strictEqual(S.shouldSendSticker({ onlyOnRequest: true, demanded: true }), true));
c('关闭门禁保留旧行为', () => assert.strictEqual(S.shouldSendSticker({ onlyOnRequest: false, demanded: false }), true));
c('请求为空也拒绝', () => assert.strictEqual(S.shouldSendSticker({ onlyOnRequest: true }), false));
console.log('\n通过 ' + p + '/' + (p + f));
process.exit(f ? 1 : 0);
