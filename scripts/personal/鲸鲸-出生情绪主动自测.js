'use strict';
/** B2-02 情绪/关系/主动自测。 */
const assert = require('node:assert');
const { createAffect, createRelationship, createProactive, inQuiet } = require('../../packages/persona-core/affect.js');

let pass = 0, fail = 0;
function check(name, fn) {
  try { fn(); pass++; console.log('  ✓ ' + name); }
  catch (e) { fail++; console.log('  ✗ ' + name + '  ' + (e && e.message)); }
}
function at(h, m = 0, day = 24) { return new Date(2026, 10, day, h, m, 0, 0).getTime(); }

check('affect 更新/标签', () => {
  const a = createAffect({ valence: 0, arousal: 0.3, updatedAt: at(9) });
  const s = a.update({ deltaV: 0.5, deltaA: 0.4, at: at(9, 1) });
  assert.ok(s.valence > 0.4);
  assert.ok(s.label.length > 0);
});

check('affect 衰减', () => {
  const a = createAffect({ valence: 0.8, arousal: 0.9, updatedAt: at(9) });
  const later = a.snapshot(at(10));
  assert.ok(later.valence < 0.8);
  assert.ok(later.arousal < 0.9);
});

check('affect clamp', () => {
  const a = createAffect({ valence: 0, arousal: 0.3, updatedAt: at(9) });
  assert.strictEqual(a.update({ deltaV: 9, deltaA: 9, at: at(9, 1) }).valence, 1);
  assert.strictEqual(a.update({ deltaV: -99, deltaA: -99, at: at(9, 2) }).valence, -1);
});

check('关系档位', () => {
  const r = createRelationship({ score: 50 });
  assert.strictEqual(r.level(), '普通');
  r.touch(35);
  assert.strictEqual(r.level(), '亲近');
});

check('静默 23–08', () => {
  assert.strictEqual(inQuiet(at(23, 30)), true);
  assert.strictEqual(inQuiet(at(7, 30)), true);
  assert.strictEqual(inQuiet(at(9)), false);
  assert.strictEqual(inQuiet(at(22, 59)), false);
});

check('静默跨午夜', () => {
  assert.strictEqual(inQuiet(at(0, 30)), true);
  assert.strictEqual(inQuiet(at(8)), false);
});

check('主动总开关', () => {
  const p = createProactive({ enabled: false, now: () => at(9) });
  assert.strictEqual(p.shouldSend({ text: 'hi', at: at(9) }).reason, 'disabled');
  p.setEnabled(true);
  assert.strictEqual(p.shouldSend({ text: 'hi2', at: at(9, 11) }).ok, true);
});

check('静默拒绝', () => {
  const p = createProactive({ now: () => at(9) });
  assert.strictEqual(p.shouldSend({ text: 'hi', at: at(23, 30) }).reason, 'quiet');
});

check('小时配额', () => {
  const p = createProactive({ maxPerHour: 2, maxPerDay: 10, cooldownMs: 0, now: () => at(9) });
  p.record({ text: 'a', at: at(9) });
  p.record({ text: 'b', at: at(9, 1) });
  assert.strictEqual(p.shouldSend({ text: 'c', at: at(9, 2) }).reason, 'hour-cap');
});

check('日配额', () => {
  const p = createProactive({ maxPerHour: 10, maxPerDay: 2, cooldownMs: 0, now: () => at(9) });
  p.record({ text: 'a', at: at(9) });
  p.record({ text: 'b', at: at(10) });
  assert.strictEqual(p.shouldSend({ text: 'c', at: at(11) }).reason, 'day-cap');
});

check('冷却', () => {
  const p = createProactive({ cooldownMs: 10 * 60000, now: () => at(9) });
  p.record({ text: 'a', at: at(9) });
  assert.strictEqual(p.shouldSend({ text: 'b', at: at(9, 5) }).reason, 'cooldown');
  assert.strictEqual(p.shouldSend({ text: 'b', at: at(9, 11) }).ok, true);
});

check('去重', () => {
  const p = createProactive({ cooldownMs: 0, now: () => at(9) });
  p.record({ text: '一样的话', key: 'k', at: at(9) });
  assert.strictEqual(p.shouldSend({ text: '换了字', key: 'k', at: at(9, 1) }).reason, 'duplicate');
});

check('配额快照', () => {
  const p = createProactive({ maxPerHour: 5, maxPerDay: 10, cooldownMs: 0, now: () => at(9) });
  p.record({ text: 'a', at: at(9) });
  const s = p.snapshot(at(9, 1));
  assert.strictEqual(s.sentHour, 1);
  assert.strictEqual(s.enabled, true);
});

console.log('\n通过 ' + pass + '/' + (pass + fail));
process.exit(fail ? 1 : 0);
