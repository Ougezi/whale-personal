'use strict';
/** I-20 commitment 记录接线。 */
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const features = require('../../src/infra/features.js');
const L = require('../../src/services/commitmentLedger.js');

let pass = 0, fail = 0;
function check(name, fn) {
  try { fn(); pass++; console.log('  ✓ ' + name); }
  catch (e) { fail++; console.log('  ✗ ' + name + '  ' + (e && e.message)); }
}
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-i20-'));
L._reset();

check('commitment 默认关', () => assert.strictEqual(features.isOn({ features: {} }, 'commitment'), false));
check('无 dataDir 不记录', () => assert.strictEqual(L.recordPromise({ text: 'x' }), null));
check('记录承诺', () => {
  const r = L.recordPromise({ dataDir: dir, text: '明天再说', now: 1000 });
  assert.ok(r && r.id);
  assert.strictEqual(r.state, 'open');
});
check('落盘文件', () => assert.ok(fs.existsSync(path.join(dir, 'commitments.json'))));
check('统计 open 1', () => assert.strictEqual(L.stats(dir).open, 1));
check('重复 id 幂等', () => {
  const r = L.recordPromise({ dataDir: dir, text: '明天再说', now: 1000 });
  assert.strictEqual(r.id, L.snapshot(dir)[0].id);
  assert.strictEqual(L.snapshot(dir).length, 1);
});
check('重启后可读', () => {
  L._reset();
  const rows = L.snapshot(dir);
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].text, '明天再说');
});
check('feature 可开', () => assert.strictEqual(features.isOn({ features: { commitment: true } }, 'commitment'), true));

console.log('\n通过 ' + pass + '/' + (pass + fail));
fs.rmSync(dir, { recursive: true, force: true });
process.exit(fail ? 1 : 0);
