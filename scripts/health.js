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
    // 2026-11-22：她会编「我这边闻着股香味」，又把话安到对方头上
    ['边界（感官+归属）', '【边界】'],
    ['内心记录', '【内心记录】'],
  ];
  for (const [label, needle] of checks) {
    if (text.includes(needle)) ok(label + ' 在');
    else bad(label + ' 丢了');
  }

  // 提示词体检：无重复【块】，估算 token 不超上限（2026-11-23）
  {
    const r = spawnSync(process.execPath, [path.join(__dirname, 'tools', 'prompt-audit.js'), '--json'], { encoding: 'utf8' });
    if (r.status !== 0) {
      bad('提示词测绘失败：' + String(r.stderr || r.stdout || '').slice(-200));
    } else {
      let audit = null;
      try { audit = JSON.parse(r.stdout); } catch { audit = null; }
      if (!audit) bad('提示词测绘结果不是 JSON');
      else {
        if (!audit.duplicated || !audit.duplicated.length) ok(`提示词无重复块（${audit.blocks} 个）`);
        else bad('提示词有重复块：' + audit.duplicated.map(([k, n]) => `${k}×${n}`).join('、'));
        if (audit.estimatedTokens <= 3000) ok(`提示词估算 ${audit.estimatedTokens} tokens（≤3000）`);
        else bad(`提示词估算 ${audit.estimatedTokens} tokens，超过 3000`);
      }
    }
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

console.log('=== 6. 文档解析库（PDF）===');
{
  // 2026-11-22：个人版打包时把 wheel 套成了 vendor/vendor，pdfium.dll 没合并到顶层，
  // 结果所有 PDF 都读不出来（日志报 Could not find library 'pdfium'）。
  const candidates = [
    path.join(ROOT, 'dist', 'whale-personal', 'bridge', 'vendor'),
    path.join(ROOT, '..', 'personal-layer', 'bridge', 'vendor'),
  ];
  const found = candidates.filter((v) => fs.existsSync(v));
  if (!found.length) {
    ok('没有找到运行目录/个人层 vendor（源码包无所谓，跳过）');
  }
  for (const vendor of found) {
    const label = path.relative(path.join(ROOT, '..'), vendor);
    const dll = path.join(vendor, 'pypdfium2_raw', 'pdfium.dll');
    const pkg = path.join(vendor, 'pypdfium2', '__init__.py');
    const nested = path.join(vendor, 'vendor');
    if (!fs.existsSync(dll)) {
      bad(`${label}: 缺 pypdfium2_raw/pdfium.dll（PDF 读不出来；把嵌套的 vendor/vendor 合并回顶层）`);
      continue;
    }
    if (!fs.existsSync(pkg)) {
      bad(`${label}: 缺 pypdfium2 包本身`);
      continue;
    }
    if (fs.existsSync(nested)) bad(`${label}: 还有多余的 vendor/vendor 嵌套，建议删掉`);
    // 真导入一次：文件在但 DLL 位数/依赖不对时，只有 import 能发现
    const py = path.join(ROOT, 'dist', 'whale-personal', 'runtime', 'python', 'python.exe');
    if (vendor.startsWith(path.join(ROOT, 'dist')) && fs.existsSync(py)) {
      const r = spawnSync(py, ['-c', 'import sys; sys.path.insert(0, sys.argv[1]); import pypdfium2; print("ok")', vendor],
        { encoding: 'utf8', timeout: 20000 });
      if (r.status !== 0) {
        bad(`${label}: pypdfium2 导入失败：` + String(r.stderr || r.stdout || '').split('\n').slice(-2).join(' '));
      } else {
        ok(`${label}: pypdfium2 可导入（PDF 能读）`);
      }
    } else {
      ok(`${label}: pdfium.dll 在`);
    }
  }
}

if (failures) {
  console.error(`\n自查失败：${failures} 项`);
  process.exit(1);
}
console.log('\n自查通过');
