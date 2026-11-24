'use strict';
/**
 * B1-01 事件日志自测：追加/重复/回放/崩溃恢复。
 * 用法：node scripts/personal/鲸鲸-出生事件日志自测.js
 */
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createEventStore } = require('../../packages/memory-core/events.js');

let pass = 0;
let fail = 0;
function check(name, fn) {
  try { fn(); pass++; console.log('  ✓ ' + name); }
  catch (e) { fail++; console.log('  ✗ ' + name + '  ' + (e && e.message)); }
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-events-'));
const file = path.join(dir, 'events.jsonl');
const store = createEventStore({ file });

function ev(id, at, text) {
  return {
    id, type: 'message.received', at,
    source: { kind: 'chat', ref: 'm-' + id },
    scope: { platform: 'wechat', chat: 'wxid_test', visibility: 'private' },
    payload: { text },
    evidence: ['m-' + id],
  };
}

check('append 3', () => {
  assert.strictEqual(store.append(ev('e1', 1, 'a')).duplicate, false);
  assert.strictEqual(store.append(ev('e2', 2, 'b')).duplicate, false);
  assert.strictEqual(store.append(ev('e3', 3, 'c')).duplicate, false);
  assert.strictEqual(store.readAll().length, 3);
});

check('duplicate 0', () => {
  const r = store.append(ev('e1', 1, 'a'));
  assert.strictEqual(r.duplicate, true);
  assert.strictEqual(store.readAll().length, 3);
});

check('restart duplicate', () => {
  const s2 = createEventStore({ file });
  assert.strictEqual(s2.append(ev('e2', 2, 'b')).duplicate, true);
  assert.strictEqual(s2.readAll().length, 3);
});

check('replay deterministic', () => {
  const texts = store.replay((acc, e) => acc.concat(e.payload.text), []);
  assert.deepStrictEqual(texts, ['a', 'b', 'c']);
});

check('evidence preserved', () => {
  const e = store.readAll()[0];
  assert.deepStrictEqual(e.evidence, ['m-e1']);
});

check('crash half-line ignored + recover', () => {
  fs.appendFileSync(file, '{"id":"broken","type":"x"', 'utf8');
  assert.strictEqual(store.readAll().length, 3);
  const r = store.recover();
  assert.ok(r.kept >= 3);
  assert.strictEqual(store.readAll().length, 3);
  assert.strictEqual(store.append(ev('e4', 4, 'd')).duplicate, false);
  assert.strictEqual(store.readAll().length, 4);
});

check('invalid event rejected', () => {
  assert.throws(() => store.append({ id: '', type: 'x', at: 1, source: {}, scope: {} }));
});

console.log('\n通过 ' + pass + '/' + (pass + fail));
fs.rmSync(dir, { recursive: true, force: true });
process.exit(fail ? 1 : 0);
