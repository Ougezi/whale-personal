'use strict';
const assert = require('node:assert');
const { isDuplicateCare } = require('../../src/services/careChat.js');
let p = 0, f = 0;
function c(n, fn) { try { fn(); p++; console.log('  ✓ ' + n); } catch (e) { f++; console.log('  ✗ ' + n + ' ' + e.message); } }
const recent = ['对方：在上班呢', '我：下午有点馋，想闻点好闻的，你在忙啥呢？'];
c('同句重复', () => assert.strictEqual(isDuplicateCare('下午有点馋，想闻点好闻的，你在忙啥呢？', recent), true));
c('标点差异仍重复', () => assert.strictEqual(isDuplicateCare('下午有点馋 想闻点好闻的 你在忙啥呢', recent), true));
c('不同句不重复', () => assert.strictEqual(isDuplicateCare('忙完了没，累不累', recent), false));
c('用户话不算', () => assert.strictEqual(isDuplicateCare('在上班呢', recent), false));
c('空句算重复', () => assert.strictEqual(isDuplicateCare('', recent), true));
console.log('\n通过 ' + p + '/' + (p + f));
process.exit(f ? 1 : 0);
