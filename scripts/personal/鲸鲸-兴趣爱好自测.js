'use strict';
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const H = require('../../src/core/hobby.js');
const S = require('../../src/services/hobby.js');
const features = require('../../src/infra/features.js');
let p = 0, f = 0;
function c(n, fn) { try { fn(); p++; console.log('  ✓ ' + n); } catch (e) { f++; console.log('  ✗ ' + n + ' ' + e.message); } }
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-hobby-'));
const now = Date.now();
let doc = H.empty(now);
c('3 个真实种子', () => assert.strictEqual(doc.interests.length, 3));
c('默认 hobbies 关', () => assert.strictEqual(features.isOn({ features: {} }, 'hobbies'), false));
c('无 ref 拒收', () => assert.strictEqual(H.observe(doc, { kind: 'self-disclosure', tags: ['collect-small-things'] }).changed, false));
const r = H.observe(doc, { kind: 'self-disclosure', ref: 'chat:1', weight: 2, tags: ['collect-small-things'], at: now });
c('有 ref 收证据', () => assert.strictEqual(r.changed, true));
c('强度增加', () => assert.ok(r.interest.strength > 70));
doc = H.tick(r.state, now + 15 * 86400000);
c('14 天降温', () => assert.strictEqual(doc.interests.find((x) => x.id === 'collect-small-things').status, 'cooling'));
doc = H.tick(doc, now + 31 * 86400000);
c('30 天休眠', () => assert.strictEqual(doc.interests.find((x) => x.id === 'collect-small-things').status, 'dormant'));
const rev = H.observe(doc, { kind: 'owner-shared', ref: 'chat:2', weight: 3, tags: ['collect-small-things'], at: now + 32 * 86400000 });
c('休眠可复活', () => assert.strictEqual(rev.interest.status, 'exploring'));
c('prompt 不编新买', () => { const line = H.promptLine(H.empty(now)); assert.ok(line.includes('我的兴趣')); assert.ok(!line.includes('今天去了')); });
c('topic 按六欲', () => assert.strictEqual(H.pickTopic(H.empty(now), '香').domain, 'smell'));
const cfg = { paths: { dataDir: dir } };
S.record(cfg, { kind: 'owner-shared', ref: 'chat:3', weight: 1, tags: ['rain-smell'], at: now });
c('同兴趣 6 轮冷却', () => {
  let d = H.empty(now);
  d = H.markMention(d, { chatKey: 'c1', text: '我攒小东西' });
  const line = H.promptLine(d, { chatKey: 'c1' });
  assert.ok(!line.includes('攒小东西'));
});
c('不同 chat 不串冷却', () => {
  let d = H.empty(now);
  d = H.markMention(d, { chatKey: 'c1', text: '我攒小东西' });
  assert.ok(H.promptLine(d, { chatKey: 'c2' }).includes('攒小东西'));
});
c('同一兴趣每天 2 次上限', () => {
  let d = H.empty(now);
  d.meta.turns = { c2: 10 };
  d.meta.mentions = { c2: [
    { id: 'collect-small-things', turn: 1, at: now, day: new Date(now).toISOString().slice(0, 10) },
    { id: 'collect-small-things', turn: 2, at: now, day: new Date(now).toISOString().slice(0, 10) },
  ] };
  assert.ok(!H.promptLine(d, { chatKey: 'c2', now }).includes('攒小东西'));
});
c('念头带兴趣', () => {
  const thoughts = require('../../src/core/thoughts.js');
  assert.ok(thoughts.harvest({}, { rng: () => 0, interestNames: ['攒小东西'] }).includes('攒小东西'));
});
c('care 带兴趣一句', () => {
  const care = require('../../src/services/care.js');
  const p = care.buildCarePrompt({ interestLine: '攒小东西' });
  assert.ok(p.system.includes('攒小东西'));
});
c('service 落盘', () => assert.ok(fs.existsSync(path.join(dir, 'interests.json'))));
c('service 状态', () => assert.ok(S.status(cfg).count === 3));
console.log('\n通过 ' + p + '/' + (p + f));
process.exit(f ? 1 : 0);
