'use strict';
/** I-13 retrieval core：默认关，开启走混合检索，失败可回退。 */
const assert = require('node:assert');
const features = require('../../src/infra/features.js');
const retrieval = require('../../src/memory/retrieval.js');

let pass = 0, fail = 0;
function check(name, fn) {
  try { fn(); pass++; console.log('  ✓ ' + name); }
  catch (e) { fail++; console.log('  ✗ ' + name + '  ' + (e && e.message)); }
}

const now = Date.now();
const card = { events: [
  { id: 'e1', title: '项目A', summary: '项目A 的进度和风险', text: '项目A 风险', date: now - 86400000, importance: 3, confidence: 1, evidence: ['m1'], participants: [] },
  { id: 'e2', title: '晚饭', summary: '晚上吃了面', text: '面', date: now - 3600000, importance: 1, confidence: 1, evidence: ['m2'], participants: [] },
] };

check('retrievalCore 默认关', () => assert.strictEqual(features.isOn({ features: {} }, 'retrievalCore'), false));
check('旧检索可用', () => assert.ok(retrieval.selectEvents(card, { query: '项目' }).length >= 1));
check('core 检索可用', () => assert.ok(retrieval.selectEvents(card, { query: '项目', core: true }).length >= 1));
check('core 尊重 topK', () => assert.ok(retrieval.selectEvents(card, { query: '项目', core: true, topK: 1 }).length <= 1));
check('空查询不炸', () => assert.ok(Array.isArray(retrieval.selectEvents(card, { query: '', core: true }))));
check('feature 可开', () => assert.strictEqual(features.isOn({ features: { retrievalCore: true } }, 'retrievalCore'), true));

console.log('\n通过 ' + pass + '/' + (pass + fail));
process.exit(fail ? 1 : 0);
