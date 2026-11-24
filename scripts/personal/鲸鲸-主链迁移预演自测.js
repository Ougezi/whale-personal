'use strict';
/** I-22 migrate dry-run。 */
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const M = require('../../src/services/migrationPreview.js');
let pass = 0, fail = 0;
function check(n, fn) { try { fn(); pass++; console.log('  ✓ ' + n); } catch (e) { fail++; console.log('  ✗ ' + n + '  ' + (e && e.message)); } }
const old = process.cwd();
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-i22-'));
process.chdir(tmp);
fs.mkdirSync(path.join('data', 'memory', 'chats', 'c1'), { recursive: true });
const file = path.join('data', 'memory', 'chats', 'c1', 'messages.jsonl');
fs.writeFileSync(file, [
  JSON.stringify({ id: 'm1', role: 'user', text: 'hi', ts: 1, seq: 1 }),
  JSON.stringify({ id: 'm2', role: 'assistant', text: 'ok', ts: 2, seq: 2 }),
].join('\n') + '\n');
const r = M.preview({ messagesFile: file, chatId: 'c1' });
check('预览成功', () => assert.strictEqual(r.ok, true));
check('源 2 行', () => assert.strictEqual(r.rows, 2));
check('事件 2 条', () => assert.strictEqual(r.events, 2));
check('dryRun 标记', () => assert.strictEqual(r.dryRun, true));
check('不写目标', () => assert.ok(!fs.existsSync(r.target)));
check('样例 2 条', () => assert.strictEqual(r.samples.length, 2));
check('哈希存在', () => assert.strictEqual(r.sourceHash.length, 64));
check('缺文件拒绝', () => assert.strictEqual(M.preview({ messagesFile: 'data/nope.jsonl', chatId: 'c1' }).ok, false));
check('缺 chatId 拒绝', () => assert.strictEqual(M.preview({ messagesFile: file }).ok, false));
check('越界路径拒绝', () => assert.strictEqual(M.preview({ messagesFile: path.join(os.tmpdir(), 'x.jsonl'), chatId: 'c1' }).ok, false));
console.log('\n通过 ' + pass + '/' + (pass + fail));
process.chdir(old); fs.rmSync(tmp, { recursive: true, force: true });
process.exit(fail ? 1 : 0);
