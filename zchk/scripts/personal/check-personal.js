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
check('六欲上限 = 250（WANT_MAX 四处 clamp）', () => {
  const s = read('src/core/mood.js');
  must(/const WANT_MAX = 250;/.test(s), 'mood.js 没有 WANT_MAX = 250');
  const hits = (s.match(/, 0, WANT_MAX\)/g) || []).length;
  must(hits >= 4, 'mood.js 里 0,WANT_MAX 的 clamp 只有 ' + hits + ' 处（应为 4）');
  must(!/, 0, (100|200)\)/.test(s), 'mood.js 里还有写死的 clamp 上限');
  return hits + ' 处';
});

check('学习：次数上限 200/100，增量 25~50 / 10~20', () => {
  const mood = require(path.join(ROOT, 'src', 'core', 'mood.js'));
  must(JSON.stringify(mood.LEARN_CAP) === JSON.stringify({ auto: 200, owner: 100 }), 'LEARN_CAP 不是 200/100');
  must(JSON.stringify(mood.LEARN_GAIN) === JSON.stringify({ auto: [25, 50], owner: [10, 20] }), 'LEARN_GAIN 不是 25~50 / 10~20');
  const fs2 = require('node:fs');
  const os2 = require('node:os');
  const dir = fs2.mkdtempSync(path.join(os2.tmpdir(), 'cp-learn-'));
  const a = mood.bumpLearn(dir, 'auto', { now: Date.now(), rng: Math.random });
  must(a.ok && a.gain >= 25 && a.gain <= 50, '自主学习每次应 +25~50，实际 ' + a.gain);
  const o = mood.bumpLearn(dir, 'owner', { now: Date.now(), rng: Math.random });
  must(o.ok && o.gain >= 10 && o.gain <= 20, '主人分享每次应 +10~20，实际 ' + o.gain);
  for (let k = 0; k < 199; k += 1) mood.bumpLearn(dir, 'auto', { now: Date.now(), rng: 0.5 });
  const cappedAuto = mood.bumpLearn(dir, 'auto', { now: Date.now(), rng: 0.5 });
  must(cappedAuto.capped === true && cappedAuto.ok === false, '自主 200 次后应到上限，实际 ' + JSON.stringify(cappedAuto));
  return 'auto ' + a.gain + ' / owner ' + o.gain + '，200 次封顶';
});

check('抖音链接：渲染 + 抓图 + 转写', () => {
  const chat = read('src/pipeline/chat.js');
  must(chat.includes('readDouyinNote'), 'chat.js 没有 readDouyinNote');
  must(/isDouyinLink\s*\?\s*180000/.test(chat), '抖音链接预算不是 180s');
  must(chat.includes('douyinSidecar'), 'chat.js 没接 sidecar');
  must(read('src/adapters/douyinSidecar.js').includes('readLink'), 'douyinSidecar.js 缺 readLink');
  const br = read('src/adapters/browser.js');
  must(br.includes('imagesFromPage'), 'browser.js 没有 imagesFromPage');
  must(br.includes('douyinDefault'), 'browser.js 没有过滤抖音占位图');
  const prompt = read('src/persona/prompt.js');
  must(prompt.includes('抓图文原图'), '提示词没说明抖音链接会抓图文');
  return 'ok';
});

check('抖音图文：图片去重/轮播 + 只收竖版原图', () => {
  const br = read('src/adapters/browser.js');
  must(br.includes('seenPath'), 'browser.js 没有按 pathname 去重');
  must(br.includes('ArrowRight'), 'browser.js 没有轮播翻页');
  const chat = read('src/pipeline/chat.js');
  must(chat.includes('x.w >= 600 && x.h >= 800'), 'chat.js 没过滤头像/横幅');
  must(read('src/adapters/gateway.js').includes('ageSec <= 120'), 'bridgeStatus 容忍度不是 120s');
  must(read('src/persona/prompt.js').includes('【发送回执】'), 'prompt 缺发送回执规则');
  return 'ok';
});

check('表情包只用本地库（隐藏 搜来的）', () => {
  const st = read('src/adapters/stickers.js');
  must(st.includes("HIDDEN_CATEGORY_LABELS"), 'stickers.js 没有隐藏分类');
  const mod = require(path.join(ROOT, 'src', 'adapters', 'stickers.js'));
  const cfg = { root: ROOT };
  must(mod.isUsableCategory(cfg, '搜来的') === false, '搜来的 仍然可发');
  const prompt = read('src/persona/prompt.js');
  must(prompt.includes('只用自己的表情库'), 'prompt 没有「只用自己的表情库」规则');
  return 'ok';
});

check('抖音插件 0.4.0 已接入（sidecar + 桥接路由）', () => {
  const b = read('bridge/douyin_agent.py');
  must(/"download"/.test(b) && b.includes('search_users') && b.includes('comments'), '桥接缺新任务路由');
  const side = require('node:fs').readFileSync('D:/dsh/profiles/desktop/whale-douyin/service.mjs', 'utf8');
  must(side.includes('buildExtTools'), 'sidecar 没接 ext 工具');
  for (const op of ['download:', 'user:', 'comments:', 'export:', 'index:', 'batch:', 'accounts:']) must(side.includes(op), 'sidecar 缺 op ' + op);
  const pkg = JSON.parse(require('node:fs').readFileSync('D:/dsh/plugins/dsh-douyin-watch/package.json', 'utf8'));
  must(pkg.version === '0.4.0', '插件版本不是 0.4.0，实际 ' + pkg.version);
  return 'ok';
});

check('插件市场面板（/api/market + 启动器窗口）', () => {
  const r = read('src/http/routes/market.js');
  must(r.includes('/api/market/plugins'), '缺 /api/market/plugins');
  must(r.includes('/api/douyin/run'), '缺 /api/douyin/run');
  must(read('src/http/routes/index.js').includes("require('./market')"), 'market 路由没注册');
  must(read('launcher/PluginMarketWindow.cs').includes('插件市场'), '启动器缺 PluginMarketWindow');
  must(read('launcher/MainWindow.xaml').includes('OnMarket'), '主窗口缺插件市场按钮');
  const side = require('node:fs').readFileSync('D:/dsh/profiles/desktop/whale-douyin/service.mjs', 'utf8');
  must(side.includes('summarize('), 'sidecar 没接 summarize');
  return 'ok';
});

check('写操作开关：主人一句话 / 标记 / 落盘', () => {
  const g = read('src/services/opsGate.js');
  must(g.includes('function parse'), 'opsGate 缺 parse');
  must(g.includes('function apply'), 'opsGate 缺 apply');
  must(g.includes('stripMarkers'), 'opsGate 缺 stripMarkers');
  const chat = read('src/pipeline/chat.js');
  must(chat.includes('handleOpsSwitch'), 'chat 没有 handleOpsSwitch');
  must(chat.includes('opsGate.stripMarkers'), 'chat 没处理 [[ops:...]] 标记');
  const prompt = read('src/persona/prompt.js');
  must(prompt.includes('【写操作开关】'), '提示词没有写操作开关说明');
  const gate = require(path.join(ROOT, 'src', 'services', 'opsGate.js'));
  const one = gate.parse('允许收藏，每天最多 3 次');
  must(one && one.intents.length >= 2, '一句多事没解析出来');
  must(gate.parse('今天天气不错') === null, '普通聊天被误判成开关');
  return 'ok';
});

check('插件市场布局：分类/卡片/详情，写操作只绑刷抖音', () => {
  const w = read('launcher/PluginMarketWindow.cs');
  must(w.includes('OpenDetail'), '缺详情页');
  must(w.includes('RenderChips'), '缺分类 chips');
  must(w.includes('BuildCard'), '缺卡片');
  must(w.includes('"douyin-watch"'), '写操作没按插件 id 绑定');
  const m = read('src/http/routes/market.js');
  for (const key of ['icon', 'category', 'desc']) must(m.includes(key + ':'), 'catalog 缺 ' + key);
  must(m.includes('刷抖音'), 'catalog 没有刷抖音条目');
  return 'ok';
});

check('插件市场：排序/置顶 + 插件介绍页', () => {
  const m = read('src/http/routes/market.js');
  must(m.includes('/api/market/order'), '缺排序/置顶接口');
  must(m.includes('intro:'), 'catalog 缺插件介绍');
  must(m.includes('highlights:'), 'catalog 缺亮点');
  const w = read('launcher/PluginMarketWindow.cs');
  must(w.includes('TogglePin'), '窗口缺置顶逻辑');
  must(w.includes('MovePlugin'), '窗口缺上移/下移逻辑');
  must(w.includes('插件介绍'), '详情页缺插件介绍');
  return 'ok';
});

check('MOTW：启动/更新都不弹「无法验证发布者」', () => {
  must(read('launcher/Motw.cs').includes('Zone.Identifier'), '缺 Motw 去标记实现');
  must(read('launcher/UpdateService.cs').includes('Motw.Remove'), '更新下载后没去 MOTW');
  must(read('scripts/personal/start-portable.ps1').includes('Unblock-File'), 'start-portable 没 unblock');
  must(read('scripts/personal/apply-update-zip.ps1').includes('Unblock-File'), 'apply-update 没 unblock');
  must(read('scripts/personal/unblock-whale.ps1').includes('Unblock-File'), '缺手动 unblock 脚本');
  must(read('scripts/personal/sign-launcher.ps1').includes('signtool'), '缺可选签名脚本');
  return 'ok';
});

check('一条命令：证书信任 + 签名 + 打包校验', () => {
  const f = read('scripts/personal/sign-and-release.ps1');
  for (const key of ['certutil', 'signtool', 'verify', 'make-update-zip', 'Expand-Archive']) must(f.includes(key), '签名链路缺 ' + key);
  must(f.includes('TrustedPublisher') && f.includes('Root'), '缺证书存储安装');
  return 'ok';
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
