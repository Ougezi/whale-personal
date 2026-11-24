'use strict';
/** B1-03 混合检索/重构自测。 */
const assert = require('node:assert');
const { hybridSearch, reconstruct, bm25, cosine, tokens, timeIntentDays, LIMITS } = require('../../packages/memory-core/retrieval.js');

let pass = 0, fail = 0;
function check(name, fn) {
  try { fn(); pass++; console.log('  ✓ ' + name); }
  catch (e) { fail++; console.log('  ✗ ' + name + '  ' + (e && e.message)); }
}

const now = Date.now();
const items = [
  { id: 'a', kind: 'episodic', summary: '启动失败 日志 报错', text: '启动失败时 bridge.log 有报错', vector: [1, 0], at: now - 1000, importance: 0.9, evidence: ['m-a'], scope: 'private' },
  { id: 'b', kind: 'episodic', summary: '启动失败 配置 端口', text: '启动失败是 8787 端口占用', vector: [0.9, 0.1], at: now - 2 * 86400000, importance: 0.5, evidence: ['m-b'], scope: 'private' },
  { id: 'c', kind: 'semantic', summary: '用户喜欢鲸鱼', text: '喜欢鲸鱼', vector: [0, 1], at: now - 1000, importance: 0.8, evidence: [], scope: 'private' },
  { id: 'd', kind: 'episodic', summary: '今天天气', text: '天气晴', vector: [0, 1], at: now - 1000, importance: 0.4, evidence: ['m-d'], scope: 'private' },
];

check('tokens 去掉泛词', () => {
  const t = tokens('那个启动失败是什么');
  assert.ok(t.includes('启动'));
  assert.ok(!t.includes('那个'));
  assert.ok(!t.includes('什么'));
});

check('BM25 排序', () => {
  const m = bm25('启动失败', items);
  assert.ok((m.get('a') || 0) > 0);
  assert.ok((m.get('a') || 0) >= (m.get('d') || 0));
});

check('cosine', () => {
  assert.ok(cosine([1, 0], [1, 0]) > 0.99);
  assert.strictEqual(cosine([1, 0], [0, 1]), 0);
});

check('hybrid answerable', () => {
  const r = hybridSearch('启动失败 日志', items, { vector: [1, 0], topK: 3 });
  assert.ok(r.answerable);
  assert.ok(r.items.some((x) => x.id === 'a'));
});

check('时间意图', () => {
  assert.strictEqual(timeIntentDays('刚才那个'), 1);
  assert.strictEqual(timeIntentDays('最近怎么样'), 3);
  assert.strictEqual(timeIntentDays('启动失败'), 0);
});

check('近期加权', () => {
  const r = hybridSearch('刚才 启动失败', items, { vector: [1, 0], topK: 3 });
  assert.strictEqual(r.items[0].id, 'a');
});

check('缺失向量补偿', () => {
  const copy = items.map((x) => x.id === 'a' ? { ...x, vector: undefined } : x);
  const r = hybridSearch('启动失败 日志', copy, { vector: [1, 0], topK: 3 });
  assert.ok(r.items.some((x) => x.id === 'a'));
});

check('semantic 无 evidence 排除', () => {
  const r = hybridSearch('鲸鱼', items, { vector: [0, 1], topK: 4 });
  assert.ok(!r.items.some((x) => x.id === 'c'));
});

check('无命中 -> 不记得', () => {
  const r = hybridSearch('量子力学 黑洞', items, { topK: 3 });
  assert.strictEqual(r.answerable, false);
  const out = reconstruct(r);
  assert.strictEqual(out.notRemember, true);
  assert.strictEqual(out.text, '');
});

check('Recall@6', () => {
  const cases = [
    ['启动失败 日志', 'a'],
    ['启动失败 配置', 'b'],
    ['今天天气', 'd'],
  ];
  let hit = 0;
  for (const [q, id] of cases) {
    const r = hybridSearch(q, items, { vector: [1, 0], topK: 6 });
    if (r.items.some((x) => x.id === id)) hit += 1;
  }
  assert.ok(hit / cases.length >= 0.85, String(hit / cases.length));
});

check('冲突并列', () => {
  const a2 = { id: 'a2', kind: 'episodic', summary: '启动失败 日志 另一种说法', text: '启动失败可能是日志权限', vector: [1, 0], at: now - 900, importance: 0.8, evidence: ['m-a2'], conflict: true };
  const r = hybridSearch('启动失败 日志', [...items, a2], { vector: [1, 0], topK: 6 });
  assert.ok(r.items.some((x) => x.id === 'a'));
  assert.ok(r.items.some((x) => x.id === 'a2'));
});

check('重构带证据', () => {
  const r = hybridSearch('启动失败 日志', items, { vector: [1, 0], topK: 2 });
  const out = reconstruct(r);
  assert.ok(out.text.includes('[a]'));
  assert.ok(out.evidence.includes('m-a'));
  assert.strictEqual(out.notRemember, false);
});

check('重构预算', () => {
  const r = hybridSearch('启动失败', items, { vector: [1, 0], topK: 4 });
  const out = reconstruct(r, { budgetChars: 20 });
  assert.ok(out.text.length <= 20 || out.text === '');
});

check('scope 过滤', () => {
  const r = hybridSearch('启动失败', items.map((x) => ({ ...x, scope: 'group' })), { vector: [1, 0], scope: 'private', topK: 3 });
  assert.strictEqual(r.answerable, false);
});

console.log('\n通过 ' + pass + '/' + (pass + fail));
process.exit(fail ? 1 : 0);
