'use strict';
const assert = require('node:assert');
const { applyFinalGuards } = require('../../src/pipeline/finalGuards.js');
let p = 0, f = 0;
function c(n, fn) { try { fn(); p++; console.log('  ✓ ' + n); } catch (e) { f++; console.log('  ✗ ' + n + ' ' + e.message); } }
c('连续重复丢弃', () => assert.strictEqual(applyFinalGuards('在呢', { recent: [{ role: 'assistant', text: '在呢' }] }).drop, true));
c('无来源刷回来替换', () => assert.ok(!applyFinalGuards('我刷回来了', {}).text.includes('刷回来')));
c('无来源查到了替换', () => assert.ok(!applyFinalGuards('查到了：6人本', {}).text.includes('查到了')));
c('文件失败不称空', () => assert.ok(applyFinalGuards('文件到我这空', { mediaFail: '文件下载失败：找不到' }).text.includes('没有下载到本地')));
c('有搜索来源保留', () => assert.strictEqual(applyFinalGuards('查到了：6人本', { searched: true }).text, '查到了：6人本'));
c('普通文本不误改', () => assert.strictEqual(applyFinalGuards('今天有点累', {}).text, '今天有点累'));
console.log('\n通过 ' + p + '/' + (p + f));
process.exit(f ? 1 : 0);
