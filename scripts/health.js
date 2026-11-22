'use strict';
/**
 * 仓库级静态自查：不依赖微信、不联网、不读密钥。
 *
 *   node scripts/health.js
 *
 * 覆盖：
 *   1. 内核所有 .js 语法（node --check）
 *   2. 桥接 Python 编译（python -m compileall）
 *   3. 个人文档参数块与代码默认值一致（tools/health/doc_sync.py）
 *   4. 个人层提示词/规则还在（抖音、open、selfRules）
 *   5. 启动器源码里没有官方入口字符串
 *
 * CI 与本地都用它；Python 不在 PATH 时用 WHALE_PYTHON 指定。
 */
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PY = process.env.WHALE_PYTHON || 'python';
let failures = 0;

function ok(msg) { console.log('  \u2713 ' + msg); }
function bad(msg) { failures += 1; console.error('  \u2717 ' + msg); }

function walk(dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) {
      if (name === 'node_modules' || name === 'vendor' || name === '__pycache__') continue;
      walk(p, out);
    } else if (name.endsWith('.js')) {
      out.push(p);
    }
  }
  return out;
}

console.log('=== 1. 内核语法 ===');
const jsFiles = walk(path.join(ROOT, 'src'));
let jsBad = 0;
for (const f of jsFiles) {
  const r = spawnSync(process.execPath, ['--check', f], { encoding: 'utf8' });
  if (r.status !== 0) {
    jsBad += 1;
    bad(path.relative(ROOT, f) + ': ' + String(r.stderr || '').split('\n').slice(-2).join(' '));
  }
}
if (!jsBad) ok(`内核 ${jsFiles.length} 个 .js 语法通过`);

console.log('=== 2. 桥接编译 ===');
{
  const r = spawnSync(PY, ['-m', 'compileall', '-q', path.join(ROOT, 'bridge')], { encoding: 'utf8' });
  if (r.status !== 0) bad('桥接编译失败：' + String(r.stderr || r.stdout || '').slice(-400));
  else ok('桥接 Python 编译通过');
}

console.log('=== 3. 文档参数同步 ===');
{
  const r = spawnSync(PY, [path.join(ROOT, 'tools', 'health', 'doc_sync.py')], {
    encoding: 'utf8',
    env: { ...process.env, WHALE_ROOT: ROOT, WHALE_DOC_CONFIG: path.join(ROOT, 'tools', 'health', 'config.ci.json'), PYTHONIOENCODING: 'utf-8' },
  });
  const out = String(r.stdout || '') + String(r.stderr || '');
  if (r.status !== 0) bad('文档参数漂移：\n' + out.trim().slice(-600));
  else ok('三份个人文档参数块与代码一致');
}

console.log('=== 4. 个人层提示词 ===');
{
  const p = path.join(ROOT, 'src', 'persona', 'prompt.js');
  const text = fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '';
  const checks = [
    ['刷抖音提示词', '【刷抖音】'],
    ['开页标记', '[[open:'],
    ['自助规则', 'selfRules'],
  ];
  for (const [label, needle] of checks) {
    if (text.includes(needle)) ok(label + ' 在');
    else bad(label + ' 丢了');
  }
}

console.log('=== 5. 启动器隔离 ===');
{
  const dir = path.join(ROOT, 'launcher');
  const banned = ['Banan1cee', 'afdian', 'bot.zyyc.cc', 'whale-girl-plugins'];
  const files = fs.readdirSync(dir).filter((n) => n.endsWith('.cs') || n.endsWith('.xaml'));
  const hits = [];
  for (const name of files) {
    const text = fs.readFileSync(path.join(dir, name), 'utf8');
    for (const b of banned) if (text.includes(b)) hits.push(`${name}: ${b}`);
  }
  if (hits.length) bad('启动器仍有官方入口：' + hits.join('; '));
  else ok('启动器源码无官方入口字符串');
}

if (failures) {
  console.error(`\n自查失败：${failures} 项`);
  process.exit(1);
}
console.log('\n自查通过');
