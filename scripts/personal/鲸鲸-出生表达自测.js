'use strict';
/** B2-01 人格/表达分离自测。 */
const assert = require('node:assert');
const { mask, unmask, markers, markersValid, renderExpression } = require('../../packages/persona-core/expression.js');

let pass = 0, fail = 0;
function check(name, fn) {
  try { fn(); pass++; console.log('  ✓ ' + name); }
  catch (e) { fail++; console.log('  ✗ ' + name + '  ' + (e && e.message)); }
}

const report = [
  '已完成：在 D:\\dsh\\whale-personal 里改了 `brain_agent.py`，版本 1.2.3。',
  '验证：npm run test 通过；参考 https://example.com/log?id=1 。',
  '```python',
  'print("hello")',
  '```',
  '未推送，data 未动。',
].join('\n');

check('mask 技术字面', () => {
  const m = mask(report);
  assert.ok(m.literals.length >= 5);
  assert.ok(!m.masked.includes('D:\\dsh'));
  assert.ok(!m.masked.includes('brain_agent.py'));
  assert.ok(!m.masked.includes('https://'));
  assert.ok(!m.masked.includes('print("hello")'));
});

check('unmask 一字不差', () => {
  const m = mask(report);
  assert.strictEqual(unmask(m.masked, m.literals), report);
});

check('markers 顺序', () => {
  const m = mask(report);
  const got = markers(m.masked);
  assert.deepStrictEqual(got, got.map((_, i) => i));
});

check('rephrase 保留 marker', () => {
  const m = mask(report);
  const out = renderExpression({ report, rephrase: (masked) => masked.replace('已完成', '弄好了') });
  assert.strictEqual(out.changed, true);
  assert.strictEqual(out.display.includes('D:\\dsh\\whale-personal'), true);
  assert.strictEqual(out.display.includes('brain_agent.py'), true);
  assert.strictEqual(out.origin, report);
});

check('origin 永不变', () => {
  const before = report;
  const out = renderExpression({ report, rephrase: (x) => x + '' });
  assert.strictEqual(out.origin, before);
  assert.strictEqual(report, before);
});

check('marker 丢失 -> 回退', () => {
  const out = renderExpression({ report, rephrase: (masked) => masked.replace('[[0]]', '') });
  assert.strictEqual(out.fallback, true);
  assert.strictEqual(out.display, report);
});

check('marker 重复 -> 回退', () => {
  const out = renderExpression({ report, rephrase: (masked) => masked + ' [[0]]' });
  assert.strictEqual(out.fallback, true);
});

check('rephrase 抛错 -> 回退', () => {
  const out = renderExpression({ report, rephrase: () => { throw new Error('model down'); } });
  assert.strictEqual(out.fallback, true);
  assert.strictEqual(out.display, report);
});

check('无 rephrase -> 原文', () => {
  const out = renderExpression({ report });
  assert.strictEqual(out.display, report);
  assert.strictEqual(out.changed, false);
  assert.strictEqual(out.fallback, false);
});

check('技术字面保护', () => {
  const out = renderExpression({ report, rephrase: (masked) => masked });
  assert.strictEqual(out.technicalPreserved, true);
  assert.strictEqual(out.display, report);
});

check('空报告', () => {
  const out = renderExpression({ report: '' });
  assert.strictEqual(out.display, '');
  assert.strictEqual(out.changed, false);
});

check('style 只影响表达参数', () => {
  const out = renderExpression({ report, style: { tone: '轻松', emoji: true }, rephrase: (masked) => masked });
  assert.strictEqual(out.style.tone, '轻松');
  assert.strictEqual(out.origin, report);
});

console.log('\n通过 ' + pass + '/' + (pass + fail));
process.exit(fail ? 1 : 0);
