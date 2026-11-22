#!/usr/bin/env node
'use strict';

/**
 * 个人层自检：把「关键行为」写成断言，防止某次部署/覆盖把改动悄悄弄丢。
 *   node scripts/personal/check-personal.js
 * 退出码 0 = 全过；1 = 有失败（会列出具体行）。
 */

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const checks = [];
const check = (name, fn) => {
  try { const msg = fn(); checks.push({ name, ok: true, msg: msg || '' }); }
  catch (err) { checks.push({ name, ok: false, msg: String((err && err.message) || err) }); }
};
const must = (cond, msg) => { if (!cond) throw new Error(msg); };

// ── 情绪 / 学习增量 ─────────────────────────────────────────────
check('六欲上限 = 200（四处 clamp）', () => {
  const s = read('src/core/mood.js');
  const hits = (s.match(/, 0, 200\)/g) || []).length;
  must(hits >= 4, 'mood.js 里 0,200 的 clamp 只有 ' + hits + ' 处（应为 4）');
  must(!/, 0, 100\)/.test(s), 'mood.js 里还有 0,100 的 clamp');
  return hits + ' 处';
});

check('学习增量：自主 33~37 / 主人 13~17', () => {
  const b = read('src/services/browse.js');
  must(b.includes("source === 'owner' ? randInt(rng, 13, 17) : randInt(rng, 33, 37)"), 'browse.js 的 writeBackFor 增量不是 35/15 的中点');
  const mod = require(path.join(ROOT, 'src', 'services', 'browse.js'));
  const auto = mod.writeBackFor('', { rng: () => 0.5, source: 'auto' }).wants['意'];
  const owner = mod.writeBackFor('', { rng: () => 0.5, source: 'owner' }).wants['意'];
  must(auto === 35 && owner === 15, '中点应 35/15，实际 ' + auto + '/' + owner);
  return auto + '/' + owner;
});

check('自主上网反应只要一句（提示词与 maxTokens）', () => {
  const b = read('src/services/browse.js');
  must(/只(输出|回)[^。\n]{0,4}一句/.test(b), 'browse.js SYSTEM 里没有「只输出这一句」');
  must(!b.includes('）。只回一句，别解释。` }'), 'browse.js user 行里重复了「只回一句」');
  must(b.includes('maxTokens: 120'), 'browse.js 没设 maxTokens:120');
});

// ── 图片 / 视频 ────────────────────────────────────────────────
check('看图有本机 OCR 兜底，且测试接口不启用兜底', () => {
  must(read('src/adapters/localOcr.js').includes('ocrBase64'), 'localOcr.js 缺少 ocrBase64');
  const v = read('src/adapters/vision.js');
  must(v.includes('allowOcr === false'), 'vision.js 没有 allowOcr 开关');
  must(v.includes('（本机 OCR，没配看图 Key）'), 'vision.js 没有 OCR 兜底返回');
  must(read('src/http/routes/vision.js').includes('allowOcr: false'), '/api/vision/test 没有关掉 OCR 兜底');
});

check('/api/vision 与 /api/fetch 都校验 token', () => {
  must(read('src/http/routes/vision.js').includes('visionAuthorized'), '/api/vision 缺 token 校验');
  must(read('src/http/routes/fetch.js').includes('x-bot-token'), '/api/fetch 缺 token 校验');
});

check('浏览器：CDP + 持久 profile + 空闲关闭 + 视频抽帧', () => {
  const b = read('src/adapters/browser.js');
  must(b.includes('PROFILE_DIR'), 'browser.js 没有持久 profile');
  must(b.includes('scheduleIdleShutdown'), 'browser.js 没有空闲关闭');
  must(b.includes('describeVideo'), 'browser.js 没有 describeVideo');
  must(b.includes("'ftyp'"), 'browser.js 没有视频类型校验');
  must(/const \{ spawn, execFile \}/.test(b), "browser.js 没导入 execFile");
});

// ── 聊天链路 ──────────────────────────────────────────────────
check('[[open:URL]] 非流式执行 + 流式剥离', () => {
  const c = read('src/pipeline/chat.js');
  must(c.includes('openMatch'), 'chat.js 没有 [[open]] 执行逻辑');
  must(c.includes("replace(/\\[\\[open[:：][^\\]]*\\]\\]/gi, '')"), 'chat.js finalize 没剥 [[open]] 标记');
  must(c.includes('browser.openPage(openTarget'), 'chat.js 没有真的抓页面');
  must(c.includes('pageTurns'), 'chat.js 没有第二轮回答');
});

check('提示词：联网能力/打开网页/[[open]] 说明', () => {
  const p = read('src/persona/prompt.js');
  must(p.includes('【联网能力】'), 'prompt.js 缺【联网能力】');
  must(p.includes('[[open:'), 'prompt.js 没教 [[open]] 标记');
  must(p.includes('不要说自己没有联网权限'), 'prompt.js 没有「别否认联网」');
});

// ── 更新渠道 / 配置 ────────────────────────────────────────────
check('更新源：api.github.com 在前，jsDelivr 用 @latest', () => {
  const u = read('launcher/UpdateManifest.cs');
  must(u.includes('api.github.com/repos/'), 'UpdateManifest 没有 api.github.com 源');
  must(u.includes('"@latest/release-manifest.json"'), 'jsDelivr 源没用 @latest');
  must(u.includes('User-Agent'), 'UpdateManifest 没带 User-Agent');
  must(!/"@main\/release-manifest\.json"/.test(u), 'UpdateManifest 还有 @main 源');
});

check('启动器：--autostart / --check-update / 端口占用提示', () => {
  const app = read('launcher/App.xaml.cs');
  const win = read('launcher/MainWindow.xaml.cs');
  const sup = read('launcher/RuntimeSupervisor.cs');
  must(app.includes('--autostart'), 'App 没有 --autostart');
  must(app.includes('--check-update'), 'App 没有 --check-update');
  must(win.includes('StartRuntimeOnLaunch'), 'MainWindow 没接 --autostart');
  must(sup.includes('被另一份鲸鲸占用'), 'RuntimeSupervisor 没有端口占用提示');
});

check('配置默认值：links 12s / 浏览器 profile 持久', () => {
  must(read('src/infra/config.js').includes('timeoutMs: 12000'), 'config.js 的 links.timeoutMs 不是 12000');
});

// ── 版本一致性 ────────────────────────────────────────────────
check('版本一致（package.json / dist / manifest / csproj）', () => {
  const rootVer = JSON.parse(read('package.json')).version;
  const distVer = fs.existsSync(path.join(ROOT, 'dist/whale-personal/package.json'))
    ? JSON.parse(read('dist/whale-personal/package.json')).version : rootVer;
  const manVer = JSON.parse(read('release-manifest.json')).latest;
  const cs = (read('launcher/WhaleLauncher.csproj').match(/<Version>([^<]+)<\/Version>/) || [])[1];
  must(rootVer === distVer, 'package.json(' + rootVer + ') != dist(' + distVer + ')');
  must(rootVer === manVer, 'package.json(' + rootVer + ') != manifest.latest(' + manVer + ')');
  must(rootVer === cs, 'package.json(' + rootVer + ') != csproj(' + cs + ')');
  return rootVer;
});

let failed = 0;
for (const c of checks) {
  if (c.ok) console.log('  ✅ ' + c.name + (c.msg ? '  [' + c.msg + ']' : ''));
  else { failed += 1; console.log('  ❌ ' + c.name + ' → ' + c.msg); }
}
console.log('\n个人层自检：' + (checks.length - failed) + '/' + checks.length + ' 通过');
process.exit(failed ? 1 : 0);
