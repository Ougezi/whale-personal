// 内核记忆逻辑自测（本轮改动：key 透传 / 事件下架 / 淘汰保护）
// 用法：node 鲸鲸-内核自测.js
'use strict';

const path = require('node:path');
const path0 = require('node:path');
const os0 = require('node:os');
const ROOT = process.env.WHALE_ROOT
  || path0.join(process.env.LOCALAPPDATA || path0.join(os0.homedir(), 'AppData', 'Local'), 'Programs', 'WhaleGirl');
const pc = require(path.join(ROOT, 'src', 'memory', 'personCard.js'));
const extractor = require(path.join(ROOT, 'src', 'memory', 'extractor.js'));
const { LIMITS } = require(path.join(ROOT, 'src', 'memory', 'constants.js'));

let pass = 0;
let fail = 0;
function check(name, ok, detail) {
  if (ok) { pass += 1; console.log('  ✓ ' + name + (detail ? '  ' + detail : '')); }
  else { fail += 1; console.log('  ✗ ' + name + (detail ? '  ' + detail : '')); }
}

console.log('=== 1. 事件下架标记 ===');
{
  const ev = pc.normalizeCard({
    version: 2, chatId: 'wechat:u:t', uid: 'u1',
    events: [{ id: 'e1', date: '2026-11-21', title: 't', summary: 's', deleted: true }],
  }, { chatId: 'wechat:u:t' });
  const list = (ev.events || []);
  check('normalizeCard 保留事件 deleted', list.length === 1 && list[0].deleted === true,
    list.length ? String(list[0].deleted) : '无事件');
  check('activeEvents 过滤掉已删除', pc.activeEvents(ev).length === 0);
}

console.log('\n=== 2. 同 key 取代（不堆条数）===');
{
  const card = pc.newCard({ chatId: 'wechat:u:t', uid: 'u1' });
  pc.addPreference(card, { text: '鲸鲸不能读 PDF', key: '能否读文档', confidence: 0.8 },
    { chatId: 'wechat:u:t' });
  pc.addPreference(card, { text: '鲸鲸现在能读 PDF', key: '能否读文档', confidence: 0.95 },
    { chatId: 'wechat:u:t' });
  const act = pc.activePreferences(card);
  check('旧值被 superseded', card.preferences.some((p) => p.superseded === true));
  check('生效条目只剩新的', act.length === 1 && act[0].text === '鲸鲸现在能读 PDF', '生效 ' + act.length);
}

console.log('\n=== 3. 抽取保留 key ===');
{
  const raw = JSON.stringify({
    summary: 'x',
    facts: [{ uid: 'u1', text: '住在武汉', key: 'city', confidence: 0.9 }],
    traits: [], events: [], threads: [], relations: [],
  });
  const r = extractor.parseEpisode(raw);
  check('parseEpisode 保留 facts[].key', !!r && r.facts[0].key === 'city',
    r && r.facts[0] ? String(r.facts[0].key) : '解析失败');
  check('提示词要求 key', /key/.test(extractor.EPISODE_SYSTEM));
}

console.log('\n=== 4. 淘汰不挤掉人工纠正 ===');
{
  const card = pc.newCard({ chatId: 'wechat:u:t', uid: 'u1' });
  const cap = LIMITS.maxPreferencesPerPerson;
  const now = Date.now();
  // 直接灌满（绕开相似合并），其中第 0 条是人工纠正且置信度最低：老规则一定先淘汰它
  card.preferences = [];
  for (let i = 0; i < cap; i++) {
    card.preferences.push({
      id: 'p' + i, key: '', text: '事实' + i, kind: 'fact',
      confidence: i === 0 ? 0.1 : 0.9, source: i === 0 ? 'manual_fix' : '', createdAt: now,
      lastMentionedAt: 0, mentions: 0, legacy: false, superseded: false, deleted: false,
    });
  }
  const before = card.preferences.length;
  pc.addPreference(card, { text: '新来的一条事实', confidence: 0.9 }, { chatId: 'wechat:u:t' });
  const kept = card.preferences.some((p) => p.text === '事实0');
  check('人工纠正仍在', kept, '灌满 ' + before + ' 条 → 现在 ' + card.preferences.length + ' 条');
  check('总数不超过上限', card.preferences.length <= cap, card.preferences.length + '/' + cap);
  check('确实淘汰了一条', card.preferences.length === cap, '应等于上限');
}

console.log('\n=== 5. 无 key 时的老路径（文本近似合并）===');
{
  const card = pc.newCard({ chatId: 'wechat:u:t', uid: 'u1' });
  pc.addPreference(card, { text: '爱吃辣的', confidence: 0.8 }, { chatId: 'wechat:u:t' });
  pc.addPreference(card, { text: '爱吃辣的', confidence: 0.9 }, { chatId: 'wechat:u:t' });
  check('完全同文不重复', pc.activePreferences(card).length === 1, '生效 ' + pc.activePreferences(card).length);
}

console.log('\n=== 6. 情绪状态机（P1）===');
{
  const os = require('node:os');
  const fs = require('node:fs');
  const mood = require(path.join(ROOT, 'src', 'core', 'mood.js'));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mood-'));

  const base = mood.baseline(1000);
  // 增量和掉速都是区间随机：测试统一注入 () => 0.5 取中点，断言才能复现
  const midRng = () => 0.5;
  check('基线 val=0.1 aro=0.35', base.valence === 0.1 && base.arousal === 0.35, '');

  // 连续被夸 → 愉快度上升
  let st = base;
  for (let i = 0; i < 3; i += 1) st = mood.update(st, '你好可爱，真乖', 1000 + i * 1000, midRng);
  check('连夸三次 valence 上升', st.valence > base.valence, String(st.valence));
  check('被夸后标签变积极', /不错|很好|雀跃/.test(mood.label(st)), mood.label(st));

  // 连续被怼 → 低落
  let st2 = base;
  for (let i = 0; i < 3; i += 1) st2 = mood.update(st2, '你真笨，烦死了', 1000 + i * 1000, midRng);
  check('连怼三次 valence 下降', st2.valence < base.valence, String(st2.valence));
  check('被怼后标签变消极', /闷|低落|生气/.test(mood.label(st2)), mood.label(st2));

  // 越界保护
  let st3 = base;
  for (let i = 0; i < 30; i += 1) st3 = mood.update(st3, '好可爱好乖爱你', 1000 + i * 1000, midRng);
  check(' valence 不超 1', st3.valence <= 1 && st3.valence >= -1, String(st3.valence));
  check(' arousal 在 0..1', st3.arousal >= 0 && st3.arousal <= 1, String(st3.arousal));

  // 衰减：40 分钟后回落到一半
  const hot = { valence: 0.9, arousal: 0.9, energy: 0.9, updated: 0 };
  const half = mood.decay(hot, mood.HALF_LIFE_MS, midRng);
  const mid = (0.1 + 0.9) / 2;
  check('半衰期后约回一半', Math.abs(half.valence - mid) < 0.05, String(half.valence));
  const long = mood.decay(hot, 10 * mood.HALF_LIFE_MS, midRng);
  check('很久后接近基线', Math.abs(long.valence - 0.1) < 0.02, String(long.valence));

  // 落盘 + 读回
  const r = mood.tick({ dir, text: '你好可爱真乖', now: 5000 });
  const again = mood.load(dir);
  check('tick 落盘', fs.existsSync(path.join(dir, 'mood.json')), '');
  check('读回来一致', again.valence === r.state.valence, String(again.valence));
  check('心情行格式', /^【此刻心情】/.test(r.line), r.line.slice(0, 16));

  // 只读预览不写盘
  const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'mood2-'));
  mood.peek({ dir: dir2, text: '你好可爱', now: 1000 });
  check('peek 不写盘', !fs.existsSync(path.join(dir2, 'mood.json')), '');
}

// 记忆上下文曾因为引用不存在的 opts 变量，每轮抛错、整块记忆被丢弃（2026-11-22）
try {
  const src = require('node:fs').readFileSync(path.join(ROOT, 'src', 'memory', 'store.js'), 'utf8');
  const bad = src.split('\n')
    .filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*'))
    .filter((l) => /\bopts\./.test(l));
  check('记忆上下文无未定义变量', bad.length === 0, bad.length ? bad[0].trim().slice(0, 40) : '');
} catch (e) {
  check('记忆上下文无未定义变量', false, String(e && e.message).slice(0, 40));
}

// 记忆的时间感与使用计数（2026-11-22）
try {
  const retrieval = require(path.join(ROOT, 'src', 'memory', 'retrieval.js'));
  const nowT = Date.now();
  const cardT = { events: [{ id: 'e1', title: '读日记', summary: '读了日记', deleted: false,
    date: new Date(nowT - 3 * 86400000).toISOString(), importance: 0.9, confidence: 0.9, participants: [] }],
    preferences: [], traits: [] };
  const picked = retrieval.selectEvents(cardT, { query: '还记得日记吗', now: nowT, topK: 5 });
  check('召回带时间感', picked.length > 0 && picked[0]._agoDays === 3, 'ago=' + (picked[0] && picked[0]._agoDays));
  check('召回记使用次数', picked.length > 0 && picked[0].useCount === 1, 'use=' + (picked[0] && picked[0].useCount));
} catch (e) {
  check('召回带时间感', false, String(e && e.message).slice(0, 30));
}

// 情景结局（resolved）必须被保留，否则「未解决」标记丢失、她会重复追问
try {
  const evOpen = pc.normalizeEvent({ summary: '还没弄完的事', resolved: false }, 'c1', Date.now());
  const evDone = pc.normalizeEvent({ summary: '已经了结的事', resolved: true }, 'c1', Date.now());
  check('情景结局保留', evOpen && evOpen.resolved === false && evDone && evDone.resolved === true,
    'open=' + (evOpen && evOpen.resolved) + ' done=' + (evDone && evDone.resolved));
} catch (e) {
  check('情景结局保留', false, String(e && e.message).slice(0, 30));
}

// 思考分级抽成模块后仍要按复杂度判断（2026-11 拆分）
try {
  const { shouldThink } = require(path.join(ROOT, 'src', 'pipeline', 'thinking.js'));
  const cfgAuto = { deepseek: { thinkingMode: 'auto' } };
  check('思考分级：复杂句开', shouldThink(cfgAuto, { text: '你还记得我上次说的那件事吗，为什么后来变了' }) === true, '');
  check('思考分级：简单句关', shouldThink(cfgAuto, { text: '在吗' }) === undefined, '');
  check('思考分级：设置可强制关', shouldThink({ deepseek: { thinkingMode: 'off' } }, { text: '为什么' }) === undefined, '');
} catch (e) {
  check('思考分级：复杂句开', false, String(e && e.message).slice(0, 30));
}

// 记忆召回抽出后：失败不抛、错误带 detail（2026-11 拆分）
(async () => {
  try {
    const { recallMemory } = require(path.join(ROOT, 'src', 'pipeline', 'recall.js'));
    const good = await recallMemory({ buildContext: async () => ({ block: 'x' }) }, {}, {});
    const bad = await recallMemory({ buildContext: async () => { throw new Error('记忆坏了'); } }, {}, {});
    check('召回成功返回 mem', good.ok === true && good.mem.block === 'x', '');
    check('召回失败不抛', bad.ok === false && String(bad.detail).includes('记忆坏了'), '');
  } catch (e) {
    check('召回成功返回 mem', false, String(e && e.message).slice(0, 30));
  }
  // finalize 的关键分支：静默/表情标记、上下文超长判定（2026-11 抽模块后的护栏）
try {
  const g = require(path.join(ROOT, 'src', 'pipeline', 'textGuards.js'));
  const sil = g.stripSilenceMark('好 ((silence:10min)) 我先忙');
  check('静默标记解析', sil.minutes === 10 && !sil.text.includes('silence'), 'minutes=' + sil.minutes);
  const st = g.stripStickerMarks('给你 [[sticker:开心]]');
  check('表情标记解析', st.category === '开心' && !st.text.includes('[['), 'cat=' + st.category);
  check('上下文超长识别', g.isContextLengthError(new Error('maximum context length exceeded')) === true, '');
  check('普通错误不误判', g.isContextLengthError(new Error('内容不合规')) === false, '');
  check('朋友圈意图识别', g.momentsIntent('去发个朋友圈吧') === true && g.momentsIntent('今天吃啥') === false, '');
} catch (e) {
  check('静默标记解析', false, String(e && e.message).slice(0, 30));
}

// 情绪分维（P1 七情，2026-11-22）：七条情绪各有自己的半衰期，三轴保持不变
try {
  const mood = require(path.join(ROOT, 'src', 'core', 'mood.js'));
  const base = mood.baseline();
  const mid = () => 0.5;
  check('七情齐全且为 0', mood.EMOTIONS.length === 7 && mood.EMOTIONS.every((k) => base.emotions[k] === 0), mood.EMOTIONS.join(''));
  const praised = mood.update(base, '你好可爱，真乖', 1000, mid);
  check('被夸点亮喜', praised.emotions.喜 > 0 && praised.emotions.怒 === 0, '喜=' + praised.emotions.喜);
  const insulted = mood.update(base, '你真笨，烦死了', 1000, mid);
  check('被骂点亮怒和恶', insulted.emotions.怒 >= 0.18 && insulted.emotions.恶 >= 0.18, '怒=' + insulted.emotions.怒);
  const loved = mood.update(base, '抱抱亲亲贴贴', 1000, mid);
  check('亲昵点亮爱与欲', loved.emotions.爱 > 0 && loved.emotions.欲 > 0, '爱=' + loved.emotions.爱 + ' 欲=' + loved.emotions.欲);
  const cold = mood.update(base, '嗯', 1000, mid);
  check('敷衍点亮哀', cold.emotions.哀 > 0, '哀=' + cold.emotions.哀);

  // 半衰期分化：20 分钟后怒减半，爱几乎还在（统一的 40 分钟做不到这件事）
  const hotEmo = { ...base, emotions: { ...base.emotions, 怒: 0.8, 爱: 0.8 }, updated: 0 };
  const after = mood.decay(hotEmo, 20 * 60 * 1000, mid);
  check('怒 20 分钟减半', Math.abs(after.emotions.怒 - 0.4) < 0.02, String(after.emotions.怒));
  check('爱 20 分钟几乎不动', after.emotions.爱 > 0.75, String(after.emotions.爱));

  let hot2 = base;
  for (let i = 0; i < 40; i += 1) hot2 = mood.update(hot2, '好可爱好乖爱你', 1000 + i);
  check('情绪不越界', mood.EMOTIONS.every((k) => hot2.emotions[k] <= 1 && hot2.emotions[k] >= 0), '');
  check('心情行不报数值', !/\d/.test(mood.line(hot2)), mood.line(hot2).slice(0, 26));
  check('最强情绪有名字', mood.topEmotions(hot2, 1).length === 1 && Boolean(mood.emotionLabel(hot2)), mood.emotionLabel(hot2));

  // v1 旧文件（只有三轴）读得进、补得上七情
  const os2 = require('node:os');
  const fs2 = require('node:fs');
  const dir3 = fs2.mkdtempSync(path.join(os2.tmpdir(), 'moodv1-'));
  fs2.writeFileSync(path.join(dir3, 'mood.json'), JSON.stringify({ valence: 0.4, arousal: 0.5, energy: 0.7, updated: 1 }));
  const v1 = mood.load(dir3);
  check('v1 文件补齐七情', v1.emotions && v1.emotions.喜 === 0 && v1.valence === 0.4, 'v=' + v1.valence);
} catch (e) {
  check('情绪分维', false, String(e && e.message).slice(0, 40));
}

// 六欲（P2 会饿，2026-11-22）：味 7/h 掉、聊天喂回来、缺了才主动搭话
try {
  const mood = require(path.join(ROOT, 'src', 'core', 'mood.js'));
  const baseW = mood.baseline(0);
  const mid = () => 0.5;
  check('六欲基线 60', mood.WANTS.length === 6 && mood.WANTS.every((k) => baseW.wants[k] === 60), mood.WANTS.join(''));
  const oneHour = mood.decay(baseW, 3600 * 1000, mid);
  check('味欲 1 小时掉 7', oneHour.wants.味 === 53, String(oneHour.wants.味));
  check('香欲 1 小时掉 3', oneHour.wants.香 === 57, String(oneHour.wants.香));
  const fed = mood.update(baseW, '晚上吃了火锅', 3600 * 1000, mid);
  check('聊到吃的会回一点', fed.wants.味 > oneHour.wants.味, fed.wants.味 + ' > ' + oneHour.wants.味);
  check('被抱一下触欲回血', mood.update(baseW, '抱抱', 1000).wants.触 > baseW.wants.触 - 1, '');
  const hungryState = { ...baseW, wants: { ...baseW.wants, 触: 12 }, updated: 0 };
  const need = mood.neediest(hungryState, 30);
  check('缺了能说出缺什么', need.needy === true && need.want === '触' && need.value === 12, JSON.stringify(need));
  check('不饿就不叫缺', mood.neediest(baseW, 30).needy === false, '');
  check('欲望不越界', mood.WANTS.every((k) => oneHour.wants[k] >= 0 && oneHour.wants[k] <= 100), '');
  check('六欲落盘', mood.update(baseW, '你好', 1000, mid).version === 4, '');

  // care 的欲望闸门：真函数 + 临时 dataDir（不碰线上状态）
  const care = require(path.join(ROOT, 'src', 'services', 'care.js'));
  const os3 = require('node:os');
  const fs3 = require('node:fs');
  const dir4 = fs3.mkdtempSync(path.join(os3.tmpdir(), 'care-'));
  const atNoon = new Date();
  const cfgCare = { paths: { dataDir: dir4 }, care: { enabled: true, everyMinutes: 1 } };
  check('没有状态文件时不拦', care.careDue(cfgCare, { lastSentTs: 0, sentToday: 0, now: atNoon.getTime() }).due === true, '');
  fs3.writeFileSync(path.join(dir4, 'mood.json'), JSON.stringify({ ...baseW, updated: atNoon.getTime() }));
  const fullCare = care.careDue(cfgCare, { lastSentTs: 0, sentToday: 0, now: atNoon.getTime() });
  check('六欲都饱时不搭话', fullCare.due === false && fullCare.reason === 'not_needy', fullCare.reason);
  fs3.writeFileSync(path.join(dir4, 'mood.json'), JSON.stringify({ ...baseW, wants: { ...baseW.wants, 味: 10 }, updated: atNoon.getTime() }));
  const hungryCare = care.careDue(cfgCare, { lastSentTs: 0, sentToday: 0, now: atNoon.getTime() });
  check('缺了才开口', hungryCare.due === true && hungryCare.desire.want === '味', JSON.stringify(hungryCare.desire));
  check('搭话词带缺口', /想吃点东西/.test(care.buildCarePrompt({ recent: [], hour: 12, wantLine: '想吃点东西' }).system), '');
  const offCfg = { paths: { dataDir: dir4 }, care: { enabled: true, everyMinutes: 1, followDesire: false } };
  check('可以关掉欲望闸门', care.careDue(offCfg, { lastSentTs: 0, sentToday: 0, now: atNoon.getTime() }).due === true, '');
} catch (e) {
  check('六欲', false, String(e && e.message).slice(0, 40));
}

// 区间随机 / 耦合 / 反刍（P3，2026-11-22）：同一句话两次痕迹深浅不同，但都在区间内
try {
  const mood = require(path.join(ROOT, 'src', 'core', 'mood.js'));
  const mid = () => 0.5;
  const base = mood.baseline(0);
  check('版本到 4', mood.VERSION === 4 && base.version === 4, String(base.version));

  // 增量是区间：200 次抽样的喜增量落在 [0.20, 0.30]，且明显不是同一个数
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < 200; i += 1) {
    const v = mood.signals('你好可爱').emotions.喜;
    lo = Math.min(lo, v);
    hi = Math.max(hi, v);
  }
  check('喜增量在区间内', lo >= 0.2 && hi <= 0.3000001, lo.toFixed(3) + '~' + hi.toFixed(3));
  check('喜增量确实随机', hi - lo > 0.05, (hi - lo).toFixed(3));

  // 掉速也是区间：1 小时味欲掉 6.3~7.7
  const hour = mood.decay(base, 3600 * 1000);
  check('味欲掉速在区间内', hour.wants.味 >= 52 && hour.wants.味 <= 54, String(hour.wants.味));

  // 反刍：同情绪 10 分钟内再来一次 → 余波尺度变大，且有上限
  let spike = mood.update(base, '你真笨', 1000000, mid);
  const firstScale = spike.scales.怒;
  spike = mood.update(spike, '你真笨', 1000000 + 10 * 60 * 1000, mid);
  check('反刍让余波更长', spike.scales.怒 > firstScale, firstScale + ' -> ' + spike.scales.怒);
  check('反刍有上限', spike.scales.怒 <= mood.RUMINATION_MAX + 1e-9, String(spike.scales.怒));
  let fresh = mood.update(base, '你真笨', 1000000, mid);
  fresh = mood.update(fresh, '你真笨', 1000000 + 3 * 3600 * 1000, mid);
  check('隔太久不反刍', fresh.scales.怒 < spike.scales.怒, String(fresh.scales.怒));

  // 耦合：饿着会低落、被喂饱更开心；单次联动一律封顶 ±0.03
  const starving = mood.coupling({ 见: 20, 听: 20, 香: 20, 味: 20, 触: 20, 意: 20 }, mid);
  check('饿着会低落', starving.哀 > 0 && starving.喜 < 0, JSON.stringify(starving));
  const rich = mood.coupling({ 见: 90, 听: 90, 香: 90, 味: 90, 触: 90, 意: 90 }, mid);
  check('被喂饱更开心', rich.喜 > 0, JSON.stringify(rich));
  const calm = mood.coupling(mood.baseWants(), mid);
  check('不饿不联动', Object.values(calm).every((v) => v === 0), '');
  check('联动封顶 0.03', Object.values(starving).every((v) => Math.abs(v) <= 0.03 + 1e-9), '');

  // 联动真的进到状态里（空文本：没有事件信号，只有耦合在动）
  const lowWants = { ...base, wants: { 见: 10, 听: 10, 香: 10, 味: 10, 触: 10, 意: 10 } };
  const coupled = mood.update(lowWants, '', 1000000, mid);
  check('联动写进状态', coupled.emotions.哀 > lowWants.emotions.哀, String(coupled.emotions.哀));
} catch (e) {
  check('区间随机/耦合/反刍', false, String(e && e.message).slice(0, 40));
}

// 念头流（P4）：跨轮携带、3 小时淡掉、最多留 5 条、每轮最多带出 2 条
try {
  const thoughts = require(path.join(ROOT, 'src', 'core', 'thoughts.js'));
  const mood = require(path.join(ROOT, 'src', 'core', 'mood.js'));
  const os4 = require('node:os');
  const fs4 = require('node:fs');
  const dir5 = fs4.mkdtempSync(path.join(os4.tmpdir(), 'th-'));
  const base = mood.baseline(0);
  const hungry = { ...base, wants: { ...base.wants, 味: 10 } };
  const r1 = thoughts.line(dir5, { state: hungry, now: 1000000, rng: () => 0 });
  check('念头行格式', /^【脑子里挂着的】/.test(r1.text) && /不一定要说出来/.test(r1.text), r1.text.slice(0, 18));
  check('饿了会想到吃的', /吃/.test(r1.text), r1.text.slice(6, 26));
  check('念头落盘', fs4.existsSync(path.join(dir5, 'thoughts.json')), '');
  const r2 = thoughts.line(dir5, { state: hungry, now: 1000500, rng: () => 0.9 });
  check('每轮最多两条', (r2.picks || []).length <= 2, String((r2.picks || []).length));
  fs4.writeFileSync(path.join(dir5, 'thoughts.json'), JSON.stringify({ version: 1, items: [{ text: '过期了', ts: 1 }] }));
  check('3 小时后淡掉', thoughts.load(dir5, 4 * 3600 * 1000).length === 0, '');
  fs4.writeFileSync(path.join(dir5, 'thoughts.json'), JSON.stringify({ version: 1, items: Array.from({ length: 8 }, (_, i) => ({ text: '念头' + i, ts: 1000 + i })) }));
  check('最多留 5 条', thoughts.load(dir5, 2000).length === 5, '');
  fs4.writeFileSync(path.join(dir5, 'thoughts.json'), '{坏的');
  check('坏文件不抛', thoughts.load(dir5, 2000).length === 0, '');
  const feat = require(path.join(ROOT, 'src', 'infra', 'features.js'));
  check('念头流有开关', feat.REGISTRY.some((x) => x.key === 'thoughts'), '');
} catch (e) {
  check('念头流', false, String(e && e.message).slice(0, 40));
}

// 自主上网 + 模型念头（P5）：nudge 写回、生成节流、浏览的纯函数
try {
  const mood5 = require(path.join(ROOT, 'src', 'core', 'mood.js'));
  const thoughtGen = require(path.join(ROOT, 'src', 'services', 'thoughtGen.js'));
  const browse = require(path.join(ROOT, 'src', 'services', 'browse.js'));
  const os5 = require('node:os');
  const fs5 = require('node:fs');

  const dir6 = fs5.mkdtempSync(path.join(os5.tmpdir(), 'nudge-'));
  mood5.tick({ dir: dir6, text: '', now: 1000000, rng: () => 0.5 });
  const nudged = mood5.nudge(dir6, { emotions: { 喜: 0.1 }, wants: { 意: 10 }, now: 1060000, rng: () => 0.5 });
  check('nudge 写进情绪', Math.abs(nudged.emotions.喜 - 0.1) < 1e-9, String(nudged.emotions.喜));
  check('nudge 写进欲望', nudged.wants.意 === 70, String(nudged.wants.意));

  const dir7 = fs5.mkdtempSync(path.join(os5.tmpdir(), 'gen-'));
  let calls = 0;
  const fake = { llm: { complete: async () => { calls += 1; return '今天有点想被抱一下。'; } }, logger: { debug() {} }, config: { thoughts: {} } };
  const first = await thoughtGen.maybe(fake, { dir: dir7, now: 1000000 });
  const callsAfterFirst = calls;
  const soon = await thoughtGen.maybe(fake, { dir: dir7, now: 1000000 + 60000 });
  const callsAfterSoon = calls;
  const later = await thoughtGen.maybe(fake, { dir: dir7, now: 1000000 + 31 * 60000 });
  check('模型念头能写进去', first === '今天有点想被抱一下。', String(first));
  check('一分钟内不重复打模型', soon === null && callsAfterSoon === callsAfterFirst, 'calls=' + callsAfterFirst + '->' + callsAfterSoon);
  check('过了间隔会再写', Boolean(later) && calls === callsAfterSoon + 1, 'calls=' + callsAfterSoon + '->' + calls);
  const offGen = { ...fake, config: { thoughts: { modelPerDay: 0 } } };
  check('perDay=0 完全关闭', (await thoughtGen.maybe(offGen, { dir: dir7, now: 1000000 + 90 * 60000 })) === null && calls === 2, 'calls=' + calls);

  check('浏览反应去引号', browse.cleanReaction('“有点意思。”\n废话') === '有点意思。', browse.cleanReaction('“有点意思。”\n废话'));
  const bs = browse.browseSettings({});
  check('浏览默认 180 分钟 / 5 次', bs.intervalMin === 180 && bs.maxPerDay === 5, JSON.stringify(bs));
  check('日期键格式', /^\d{4}-\d{2}-\d{2}$/.test(browse.dayKey(Date.now())), browse.dayKey(Date.now()));

  // BUG 回归：写回必须跟着那句话的情绪走，不能一律加"喜"
  const neg = browse.writeBackFor('这事我真没法接受，太不尊重人了。', { rng: () => 0.5 });
  check('负面内容不涨喜', !Object.prototype.hasOwnProperty.call(neg.emotions, '喜'), JSON.stringify(neg.emotions));
  // 35 / 15 是上限：抽样必须落在 [上限的一半, 上限] 且真的在浮动（不是固定值）
  const autoSamples = Array.from({ length: 200 }, () => browse.writeBackFor('', { rng: Math.random, source: 'auto' }).wants.意);
  check('自主上网好奇 ≤35 且浮动', autoSamples.every((v) => v >= 18 && v <= 35) && new Set(autoSamples).size > 3,
    Math.min(...autoSamples) + '~' + Math.max(...autoSamples));
  const ownerSamples = Array.from({ length: 200 }, () => browse.writeBackFor('', { rng: Math.random, source: 'owner' }).wants.意);
  check('主人分享好奇 ≤15 且浮动', ownerSamples.every((v) => v >= 8 && v <= 15) && new Set(ownerSamples).size > 3,
    Math.min(...ownerSamples) + '~' + Math.max(...ownerSamples));
  // 六欲上限 250（超出要夹住）
  const capDir = require('node:fs').mkdtempSync(require('node:path').join(require('node:os').tmpdir(), 'mood-cap-'));
  mood5.nudge(capDir, { wants: { 意: 400 }, now: 1060000 });
  check('六欲上限 250', mood5.load(capDir).wants.意 === 250, String(mood5.load(capDir).wants.意));
  const warm = browse.writeBackFor('好想被抱一下', { rng: () => 0.5 });
  check('亲昵的话喂到触', (warm.wants.触 || 0) > 0, JSON.stringify(warm.wants));
  // BUG 回归：关键词误报（自主上网拿这些正则读新闻标题时暴露）
  check('真好奇不算被夸', !(mood5.signals('我还真好奇那儿吃饭啥价位。').emotions.喜 > 0), '');
  check('菜价不算骂人', !(mood5.signals('菜价涨了不少').emotions.怒 > 0), '');
  check('滚动新闻不算骂人', !(mood5.signals('滚动新闻').emotions.怒 > 0), '');
  check('又来一条不算催促', !(mood5.signals('又来一条').emotions.惧 > 0), '');
  check('听证会不算想听', !(mood5.feedWants('听证会明天开').听 > 0), '');
  check('真夸还算夸', mood5.signals('你真棒').emotions.喜 > 0, '');
  check('滚还算骂人', mood5.signals('滚').emotions.怒 > 0, '');

  // 客户端入口：微信里说「去看看」就真的去看（口令 + 回复文案）
  check('口令认得出', browse.isBrowseAsk('去看看') && browse.isBrowseAsk('上网看看') && browse.isBrowseAsk(' 看看热榜 '), '');
  check('普通聊天不误触', !browse.isBrowseAsk('今天吃了火锅') && !browse.isBrowseAsk('去看看吗'), '');
  const okReply = browse.formatReply({ ok: true, title: '芒果台造梗方面有多权威', reaction: '芒果台这造梗能力确实牛啊' }).text;
  check('口令回复带标题和反应', /芒果台造梗/.test(okReply) && /确实牛/.test(okReply), okReply.slice(0, 24));
  check('上限有话说', browse.formatReply({ ok: false, reason: 'daily_cap' }).text.includes('明天'), '');
  check('关闭有话说', browse.formatReply({ ok: false, reason: 'disabled' }).text.includes('启动器'), '');

  const feat5 = require(path.join(ROOT, 'src', 'infra', 'features.js'));
  check('自主上网有开关', feat5.REGISTRY.some((x) => x.key === 'browse'), '');

  // BUG 回归：BrowseService 不能在构造时缓存 runtime.config（热重载会换对象）
  const dir8 = fs5.mkdtempSync(path.join(os5.tmpdir(), 'browse-'));
  const runtime8 = { config: { paths: { dataDir: dir8 }, features: { browse: false } }, logger: { warn() {}, debug() {} } };
  const svc8 = new browse.BrowseService(runtime8);
  check('浏览服务读得到配置', svc8.dataDir() === dir8, svc8.dataDir());
  const off8 = await svc8.tick({ now: Date.now() });
  check('关掉后不去看', off8.ok === false && off8.reason === 'disabled', JSON.stringify(off8));
  runtime8.config.features.browse = true;   // 模拟热重载后开关变了
  check('热重载后立刻生效', svc8.config.features.browse === true && svc8.dataDir() === dir8, String(svc8.config.features.browse));

  // BUG 回归：念头两路写入不能互相覆盖（模板 line + 异步模型 add）
  const dir9 = fs5.mkdtempSync(path.join(os5.tmpdir(), 'merge-'));
  const th9 = require(path.join(ROOT, 'src', 'core', 'thoughts.js'));
  th9.add(dir9, '模型写的那一条', 1000);
  th9.line(dir9, { state: mood5.baseline(0), now: 1001, rng: () => 0.9 });
  const texts9 = th9.load(dir9, 1001).map((x) => x.text);
  check('两路念头都还在', texts9.includes('模型写的那一条'), texts9.join('|'));

  // BUG 回归：演示模式（mock）不写模型念头
  const mockGen = { llm: { complete: async () => 'x', isMock: true }, logger: { debug() {} }, config: { thoughts: {} } };
  check('mock 模式不生成念头', (await thoughtGen.maybe(mockGen, { dir: dir9, now: 2000 })) === null, '');
} catch (e) {
  check('自主上网/模型念头', false, String(e && e.message).slice(0, 40));
}

// P2：用量账本与饿提示、情绪影响行为（2026-11）
try {
  const meter = require(path.join(ROOT, 'src', 'core', 'usageMeter.js'));
  const dirm = require('node:fs').mkdtempSync(path.join(require('node:os').tmpdir(), 'usage-'));
  const empty = meter.state({ dir: dirm, limit: 1000 });
  check('用量账本初始为 0', empty.tokens === 0 && empty.ratio === 0, '');
  meter.record(900, { dir: dirm, limit: 1000 });
  const st = meter.state({ dir: dirm, limit: 1000 });
  check('用量记账', st.tokens === 900 && Math.round(st.ratio * 100) === 90, 'tokens=' + st.tokens);
  check('额度紧张会饿', meter.hungerLine({ dir: dirm, limit: 1000 }).includes('有点饿'), '');
  const mood9 = require(path.join(ROOT, 'src', 'core', 'mood.js'));
  const st2 = mood9.baseline(0);
  st2.emotions = { 喜: 0, 怒: 0.9, 哀: 0, 惧: 0, 爱: 0.1, 恶: 0, 欲: 0 };
  check('生气时说话更冲', mood9.line(st2).includes('更短更冲'), mood9.line(st2).slice(0, 30));
} catch (e) {
  check('用量账本初始为 0', false, String(e && e.message).slice(0, 40));
}

console.log('\n通过 ' + pass + '/' + (pass + fail));
  process.exit(fail ? 1 : 0);
})();
