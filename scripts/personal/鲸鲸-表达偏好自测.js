'use strict';
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const P = require('../../src/core/expressionPrefs.js');
const Q = require('../../src/core/expressionPolicy.js');
let p = 0, f = 0;
function c(n, fn) { try { fn(); p++; console.log('  ✓ ' + n); } catch (e) { f++; console.log('  ✗ ' + n + ' ' + e.message); } }
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-pref-'));
c('不喜欢水滴 → 禁 💧', () => assert.ok(P.learn(dir, '我不喜欢水滴').bannedEmojis.includes('💧')));
c('少发 💧 → 降频不封禁', () => { const r = P.learn(dir, '少发💧'); assert.ok(r.reducedEmojis.includes('💧')); assert.ok(!r.bannedEmojis.includes('💧')); });
c('过滤文本', () => assert.strictEqual(P.filterText('好💧', ['💧']), '好'));
c('其他 emoji 保留', () => assert.strictEqual(P.filterText('好🐋', ['💧']), '好🐋'));
c('可以发了 → 解除', () => assert.ok(!P.learn(dir, '可以发💧了').bannedEmojis.includes('💧')));
c('prompt 有偏好', () => { P.learn(dir, '我不喜欢💧'); assert.ok(P.line(dir).includes('💧')); });
c('policy 排除 ban', () => assert.ok(!Q.policyFrom({ bannedEmojis: ['💧'] }).banned.has('🐋') && !Q.pool(Q.BASE_EMOJIS, Q.policyFrom({ bannedEmojis: ['💧'] })).includes('💧')));
c('policy reduce 不是 0', () => assert.strictEqual(Q.chance('💧', Q.policyFrom({ reducedEmojis: ['💧'] }), 1), 0.05));
c('policy filter 去 ban', () => assert.strictEqual(Q.filterBanned('好💧', Q.policyFrom({ bannedEmojis: ['💧'] })), '好'));
c('policy 可保留 reduce', () => assert.strictEqual(Q.shouldKeep('💧', Q.policyFrom({ reducedEmojis: ['💧'] }), () => 0.01), true));
c('policy 从 preferences 读 ban', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-policy-'));
  fs.mkdirSync(path.join(dir, 'self'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'self', 'preferences.json'), JSON.stringify({ items: [{ target: '💧', mode: 'ban', scope: 'master-private', status: 'active' }] }), 'utf8');
  assert.ok(Q.load(dir, { scope: 'master-private' }).banned.has('💧'));
});
c('revoked 不生效', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-policy-'));
  fs.mkdirSync(path.join(dir, 'self'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'self', 'preferences.json'), JSON.stringify({ items: [{ target: '💧', mode: 'ban', scope: 'master-private', status: 'revoked' }] }), 'utf8');
  assert.ok(!Q.load(dir, { scope: 'master-private' }).banned.has('💧'));
});
console.log('\n通过 ' + p + '/' + (p + f));
process.exit(f ? 1 : 0);
