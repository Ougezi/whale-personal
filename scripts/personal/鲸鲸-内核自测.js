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
  // 固定「上午」：care 窗口 09:00-12:00 不含 12:00 整，卡在边界会让用例假挂
  const atNoon = new Date(2026, 10, 22, 11, 0, 0);
  const cfgCare = { paths: { dataDir: dir4 }, care: { enabled: true, everyMinutes: 1 } };
  check('没有状态文件时不拦', care.careDue(cfgCare, { lastSentTs: 0, sentToday: 0, now: atNoon.getTime() }).due === true, '');
  fs3.writeFileSync(path.join(dir4, 'mood.json'), JSON.stringify({ ...baseW, updated: Date.now() }));
  const fullCare = care.careDue(cfgCare, { lastSentTs: 0, sentToday: 0, now: atNoon.getTime() });
  check('六欲都饱时不搭话', fullCare.due === false && fullCare.reason === 'not_needy', fullCare.reason);
  fs3.writeFileSync(path.join(dir4, 'mood.json'), JSON.stringify({ ...baseW, wants: { ...baseW.wants, 味: 10 }, updated: Date.now() }));
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
  // 学习：上限是「次数」不是数值；每次增量 25~50（自主）/ 10~20（主人）
  const mkTmp = (tag) => require('node:fs').mkdtempSync(require('node:path').join(require('node:os').tmpdir(), tag));
  const nowL = 1060000;
  const learnDir = mkTmp('learn-auto-');
  const firstLearn = mood5.bumpLearn(learnDir, 'auto', { now: nowL, rng: Math.random });
  check('自主学习每次 +25~50', firstLearn.ok && firstLearn.gain >= 25 && firstLearn.gain <= 50, String(firstLearn.gain));
  let lastAuto = firstLearn;
  for (let i2 = 1; i2 < 200; i2 += 1) lastAuto = mood5.bumpLearn(learnDir, 'auto', { now: nowL, rng: Math.random });
  check('自主学习次数上限 200', lastAuto.count === 200 && !lastAuto.capped, String(lastAuto.count));
  const overAuto = mood5.bumpLearn(learnDir, 'auto', { now: nowL, rng: Math.random });
  check('第 201 次不再涨意', overAuto.ok === false && overAuto.capped === true && overAuto.gain === 0, JSON.stringify(overAuto));
  const ownerDirL = mkTmp('learn-owner-');
  let lastOwner = null;
  for (let i3 = 0; i3 < 100; i3 += 1) lastOwner = mood5.bumpLearn(ownerDirL, 'owner', { now: nowL, rng: Math.random });
  check('主人分享每次 +10~20', lastOwner.gain >= 10 && lastOwner.gain <= 20, String(lastOwner.gain));
  check('主人分享次数上限 100', lastOwner.count === 100 && !lastOwner.capped, String(lastOwner.count));
  const overOwner = mood5.bumpLearn(ownerDirL, 'owner', { now: nowL, rng: Math.random });
  check('主人分享第 101 次到上限', overOwner.capped === true && overOwner.ok === false, JSON.stringify(overOwner));
  const nextDayDir = mkTmp('learn-day-');
  const day1 = mood5.bumpLearn(nextDayDir, 'owner', { now: nowL, rng: Math.random });
  const day2 = mood5.bumpLearn(nextDayDir, 'owner', { now: nowL + 24 * 3600 * 1000, rng: Math.random });
  check('学习次数按天重置', day1.count === 1 && day2.count === 1 && day2.gain >= 10, JSON.stringify({ d1: day1.count, d2: day2.count }));
  // 六欲上限 250（超出要夹住）
  const capDir = mkTmp('mood-cap-');
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

// 会话与会话上下文 + 内心记录（2026-11-22 抽模块）
try {
  const fsx = require('node:fs');
  const osx = require('node:os');
  const sess = require(path.join(ROOT, 'src', 'pipeline', 'session.js'));
  const n1 = sess.normalize({ platform: 'web', chatId: 'c1', senderName: 'a', text: '你好', chatType: 'group' });
  check('会话归一化', n1.chatType === 'group' && n1.text === '你好' && n1.senderId === 'anonymous', JSON.stringify(n1).slice(0, 40));
  check('会话 key', sess.sessionKey({ platform: 'web', chatType: 'group', chatId: 'g1' }) === 'web:g:g1', '');
  const inner = require(path.join(ROOT, 'src', 'core', 'innerNotes.js'));
  const idir = fsx.mkdtempSync(path.join(osx.tmpdir(), 'inner-'));
  inner.append('feel', '测试感受', { dir: idir });
  check('内心记录能写能读', inner.recent('feelings', 1, { dir: idir })[0].text === '测试感受', '');
  const cc = inner.consume('好 [[lesson:以后先确认是谁说的]] 的', { dir: idir });
  check('标记收走并写入', !cc.text.includes('[[') && cc.writes.length === 1 && inner.recent('lessons', 1, { dir: idir }).length === 1, cc.text);
  check('感受教训带进提示词', inner.block({ dir: idir }).includes('心里记着的'), '');
  const cc2 = inner.consume('好[[feel：全角冒号也收]]的', { dir: idir });
  check('全角冒号标记', cc2.writes.length === 1 && !cc2.text.includes('[['), cc2.text);
  const cc3 = inner.consume('前[[feel：' + '啊'.repeat(250) + ']]后', { dir: idir });
  check('超长标记不泄漏', !cc3.text.includes('[[') && cc3.writes.length === 1
    && inner.recent('feelings', 1, { dir: idir })[0].text.length <= 200, cc3.text);
  const cc4 = inner.consume('看[[feel 没写冒号]]的', { dir: idir });
  check('半截标记不留渣', !cc4.text.includes('[') && !cc4.text.includes(']'), cc4.text);
  const dupA = inner.append('feel', '重复句', { dir: idir });
  const dupB = inner.append('feel', '重复句', { dir: idir });
  check('感受去重', dupA.ok && dupB.duplicate === true
    && inner.recent('feelings', 20, { dir: idir }).filter((x) => x.text === '重复句').length === 1, JSON.stringify(dupB));
  const pdir = fsx.mkdtempSync(path.join(osx.tmpdir(), 'prune-'));
  fsx.mkdirSync(path.join(pdir, 'inner'), { recursive: true });
  fsx.writeFileSync(path.join(pdir, 'inner', 'feelings.md'), '- [04-01 10:00] 很久以前\n- [11-22 10:00] 最近\n');
  const dropped = inner.prune({ dir: pdir, now: new Date(2026, 10, 23).getTime(), keepDays: 90 });
  check('感受过期清理', dropped === 1 && inner.recent('feelings', 5, { dir: pdir }).length === 1, String(dropped));
  // 备份要带上感受/教训/日记
  const fsb = require('node:fs');
  const root2 = fsb.mkdtempSync(path.join(require('node:os').tmpdir(), 'bk-'));
  fsb.mkdirSync(path.join(root2, 'data', 'memory'), { recursive: true });
  fsb.mkdirSync(path.join(root2, 'data', 'inner'), { recursive: true });
  fsb.writeFileSync(path.join(root2, 'data', 'memory', 'note.txt'), 'x');
  fsb.writeFileSync(path.join(root2, 'data', 'inner', 'feelings.md'), '- [11-22 23:00] 测试\n');
  const bk = require(path.join(ROOT, 'src', 'memory', 'backup.js')).collect(root2);
  check('备份含感受记录', Object.keys(bk.files.inner || {}).includes('feelings.md'), JSON.stringify(Object.keys(bk.files)));
  const sum = require(path.join(ROOT, 'src', 'memory', 'backup.js')).summarize(bk);
  check('备份摘要含感受条数', sum.feelings >= 1 && typeof sum.diaryDays === 'number', JSON.stringify(sum));
  // 读回标记（marks.expandInnerRead）
  const marks = require(path.join(ROOT, 'src', 'pipeline', 'marks.js'));
  const selfM = { config: { paths: { dataDir: idir.replace(/[\\/]inner$/, '') } } };
  const readMaster = marks.expandInnerRead(selfM, { msg: { isMaster: true, chatType: 'private' } }, '[[feel:read]]');
  check('主人能读回感受', readMaster.includes('测试感受') || readMaster.includes('全角'), readMaster.slice(0, 30));
  const readGroup = marks.expandInnerRead(selfM, { msg: { isMaster: false, chatType: 'group' } }, '[[feel:read]]');
  check('群聊不泄露感受', readGroup === '', readGroup);
  fsb.rmSync(root2, { recursive: true, force: true });
} catch (e) {
  check('会话归一化', false, String(e && e.message).slice(0, 40));
}

// 事件双时态（S1，2026-11-23）
try {
  const mk = () => pc.normalizeCard({ version: 2, chatId: 'wechat:u:tt', uid: 'u9', events: [] }, { chatId: 'wechat:u:tt' });
  const c1 = mk();
  const e1 = pc.addEvent(c1, { id: 'va', date: '2026-11-20', title: '换工作', summary: '他说想换工作', importance: 0.6, confidence: 0.8 }, { chatId: 'wechat:u:tt', now: 1000 });
  check('新事件 validTo 为空', e1 && e1.validTo === null && e1.validFrom === 1000, JSON.stringify({ vf: e1 && e1.validFrom, vt: e1 && e1.validTo }));
  check('旧卡旧事件读入 validFrom=createdAt',
    pc.normalizeEvent({ summary: '旧事件', createdAt: 500 }, 'c', 999).validFrom === 500, '');
  const c2 = mk();
  pc.addEvent(c2, { id: 'old1', date: '2026-11-01', title: '旧', summary: '旧事件摘要', importance: 0.5, confidence: 0.7 }, { chatId: 'wechat:u:tt', now: 100 });
  pc.addEvent(c2, { id: 'new1', date: '2026-11-02', title: '新', summary: '完全不同的新事', supersedes: 'old1' }, { chatId: 'wechat:u:tt', now: 200 });
  const oldEv = c2.events.find((e) => e.id === 'old1');
  check('显式 supersedes 让旧事件失效', oldEv && oldEv.validTo === 200 && oldEv.supersededBy === 'new1', JSON.stringify(oldEv));
  check('失效事件不进 activeEvents', pc.activeEvents(c2).every((e) => e.id !== 'old1'), '');
  const c3 = mk();
  pc.addEvent(c3, { id: 'same1', date: '2026-11-01', title: '工作', summary: '他在找工作', importance: 0.5, confidence: 0.7 }, { chatId: 'wechat:u:tt', now: 100 });
  pc.addEvent(c3, { id: 'same2', date: '2026-11-03', title: '工作', summary: '他在找工作', importance: 0.5, confidence: 0.7 }, { chatId: 'wechat:u:tt', now: 300 });
  const dupEv = c3.events.find((e) => e.id === 'same1');
  check('同标题近重复自动失效', dupEv && dupEv.validTo === 300 && dupEv.supersededBy === 'same2', JSON.stringify(dupEv));
} catch (e) {
  check('事件双时态', false, String(e && e.message).slice(0, 50));
}

// 来源 → 置信度（S2，2026-11-23）
try {
  const fmt = require(path.join(ROOT, 'src', 'memory', 'format.js'));
  check('来源置信度定值', pc.sourceConfidence('owner') === 0.95 && pc.sourceConfidence('group') === 0.8
    && pc.sourceConfidence('self') === 0.5 && pc.sourceConfidence('web') === 0.4, '');
  const evOwner = pc.normalizeEvent({ summary: '主人说的', source: { kind: 'owner' } }, 'c', 1);
  check('没给置信度时按来源定值', evOwner.confidence === 0.95 && evOwner.source.kind === 'owner', String(evOwner.confidence));
  const evExplicit = pc.normalizeEvent({ summary: 'x', confidence: 0.3, source: { kind: 'owner' } }, 'c', 1);
  check('显式置信度优先', evExplicit.confidence === 0.3, String(evExplicit.confidence));
  const evOld = pc.normalizeEvent({ summary: '旧事件' }, 'c', 1);
  check('无来源按默认 0.6', evOld.confidence === 0.6 && evOld.source.kind === null, String(evOld.confidence));
  const lineGuess = fmt.indexLine(pc.normalizeEvent({ id: 'g', date: '2026-11-01', title: 't', summary: 's', confidence: 0.3, source: { kind: 'self' } }, 'c', 1));
  check('低置信度标推测', lineGuess.includes('（推测）'), lineGuess);
  const lineOwner = fmt.indexLine(pc.normalizeEvent({ id: 'o', date: '2026-11-01', title: 't', summary: 's', confidence: 0.95, source: { kind: 'owner' } }, 'c', 1));
  check('主人亲口标 TA 说过', lineOwner.includes('（TA 说过）'), lineOwner);
} catch (e) {
  check('来源置信度', false, String(e && e.message).slice(0, 50));
}

// 审计 + 读取预算（S3/S4，2026-11-23）
try {
  const fsx = require('node:fs');
  const osx = require('node:os');
  const audit = require(path.join(ROOT, 'src', 'memory', 'audit.js'));
  const fmt2 = require(path.join(ROOT, 'src', 'memory', 'format.js'));
  const { withTimeout } = require(path.join(ROOT, 'src', 'infra', 'async.js'));
  const adir = fsx.mkdtempSync(path.join(osx.tmpdir(), 'audit-'));
  audit.append(adir, { kind: 'event', id: 'a1', action: 'add' });
  audit.append(adir, { kind: 'preference', id: 'a2', action: 'add' });
  audit.append(adir, { kind: 'event', id: 'a3', action: 'supersede' });
  check('审计读写', audit.recent(adir, 10).length === 3 && audit.recent(adir, 10)[2].id === 'a3', String(audit.recent(adir, 10).length));
  check('审计条数限制', audit.recent(adir, 2).length === 2, '');
  check('截断助手', fmt2.capBlockText('一二三四五六七八', 4) === '一二三四…', fmt2.capBlockText('一二三四五六七八', 4));
  const fast = await withTimeout(Promise.resolve('ok'), 100, 'fallback');
  check('超时工具：正常返回', fast === 'ok', String(fast));
  const slow = await withTimeout(new Promise((r) => setTimeout(() => r('late'), 300)), 30, 'fallback');
  check('超时工具：超时回退', slow === 'fallback', String(slow));
} catch (e) {
  check('审计读写', false, String(e && e.message).slice(0, 50));
}

// 选择性入库（M1，2026-11-23）
try {
  const filter = require(path.join(ROOT, 'src', 'memory', 'filter.js'));
  check('过滤纯表情', filter.worthRemembering('[微笑][微笑]') === false, '');
  check('过滤纯 @', filter.worthRemembering('@某人') === false, '');
  check('过滤短反应', filter.worthRemembering('哈哈哈哈') === false, '');
  check('过滤太短', filter.worthRemembering('好') === false, '');
  check('保留正常句子', filter.worthRemembering('今天去面试了，感觉还行') === true, '');
  check('@ 后面有内容要记', filter.worthRemembering('@某人 明天下午三点开会') === true, '');
} catch (e) {
  check('选择性入库', false, String(e && e.message).slice(0, 40));
}

// 分层与教训状态（M2，2026-11-23）
try {
  const fsx = require('node:fs');
  const osx = require('node:os');
  const inner2 = require(path.join(ROOT, 'src', 'core', 'innerNotes.js'));
  const d2 = fsx.mkdtempSync(path.join(osx.tmpdir(), 'm2-'));
  fsx.mkdirSync(path.join(d2, 'inner'), { recursive: true });
  fsx.writeFileSync(path.join(d2, 'inner', 'lessons.md'), '- [11-20 10:00] 旧格式教训\n');
  check('旧行默认已确认', inner2.recent('lessons', 1, { dir: d2 })[0].status === 'confirmed', '');
  inner2.append('lesson', '待确认教训', { dir: d2 });
  check('新教训默认 pending', inner2.recent('lessons', 1, { dir: d2 })[0].status === 'pending', '');
  check('pending 不进提示词', !inner2.block({ dir: d2 }).includes('待确认教训'), '');
  inner2.append('lesson', '已确认教训', { dir: d2, status: 'confirmed' });
  check('confirmed 进提示词', inner2.block({ dir: d2 }).includes('已确认教训'), '');
  const evL = pc.normalizeEvent({ summary: 'x', layer: 'L2' }, 'c', 1);
  const evD = pc.normalizeEvent({ summary: 'y' }, 'c', 1);
  check('事件分层默认 L1', evL.layer === 'L2' && evD.layer === 'L1', evL.layer + '/' + evD.layer);
} catch (e) {
  check('教训状态', false, String(e && e.message).slice(0, 40));
}

// 夜间睡眠任务（M3，2026-11-23）
try {
  const fsx = require('node:fs');
  const osx = require('node:os');
  const sleep = require(path.join(ROOT, 'src', 'services', 'memorySleep.js'));
  const now = new Date(2026, 10, 23, 10, 0).getTime();
  const DAY = 86400000;
  const root2 = fsx.mkdtempSync(path.join(osx.tmpdir(), 'sleep-'));
  const pdir = path.join(root2, 'data', 'memory', 'chats', 'h1', 'people');
  fsx.mkdirSync(pdir, { recursive: true });
  const card = {
    version: 2, chatId: 'c1', uid: 'u1',
    events: [
      { id: 'e1', title: '工作', summary: '他在找工作', createdAt: now - 40 * DAY, importance: 0.3, layer: 'L1' },
      { id: 'e2', title: '工作', summary: '他在找工作', createdAt: now - 10 * DAY, importance: 0.3, layer: 'L1' },
      { id: 'e3', title: '旅行', summary: '他想去旅行', createdAt: now - 1 * DAY, importance: 0.6, resolved: false, keywords: ['旅行'] },
      { id: 'e4', title: '换房', summary: '他在看房子', createdAt: now - 2 * DAY, importance: 0.6, resolved: false },
      { id: 'e5', title: '考试', summary: '他要考试了', createdAt: now - 3 * DAY, importance: 0.6, resolved: false },
      { id: 'e6', title: '旧事', summary: '很久以前的小事', createdAt: now - 40 * DAY, importance: 0.2, layer: 'L1' },
    ],
  };
  fsx.writeFileSync(path.join(pdir, 'p1.json'), JSON.stringify(card));
  const idir = path.join(root2, 'data', 'inner');
  fsx.mkdirSync(idir, { recursive: true });
  const old = new Date(now - 10 * DAY);
  const at = String(old.getMonth() + 1).padStart(2, '0') + '-' + String(old.getDate()).padStart(2, '0') + ' 10:00';
  fsx.writeFileSync(path.join(idir, 'lessons.md'), '- [' + at + '] (pending) 旧教训\n');
  const rep = sleep.run({ dataDir: path.join(root2, 'data'), now });
  const after = JSON.parse(fsx.readFileSync(path.join(pdir, 'p1.json'), 'utf8'));
  const e1 = after.events.find((e) => e.id === 'e1');
  const e6 = after.events.find((e) => e.id === 'e6');
  check('睡眠：矛盾失效', rep.conflicted >= 1 && e1 && e1.validTo === now, JSON.stringify(rep));
  check('睡眠：旧事归档', rep.consolidated >= 1 && e6 && e6.validTo === now
    && fsx.existsSync(path.join(root2, 'data', 'memory', 'archive.md')), String(rep.consolidated));
  check('睡眠：教训晋升', rep.promoted === 1 && !fsx.readFileSync(path.join(idir, 'lessons.md'), 'utf8').includes('(pending)'), String(rep.promoted));
  check('睡眠：洞察产出', rep.insights >= 1 && fsx.readFileSync(path.join(idir, 'insights.md'), 'utf8').includes('没结局'), String(rep.insights));
  const again = sleep.maybeRun({ dataDir: path.join(root2, 'data'), now });
  check('睡眠：同日幂等', again.ran === false, again.reason || '');
} catch (e) {
  check('睡眠任务', false, String(e && e.message).slice(0, 50));
}

// 记忆体检（M4，2026-11-23）
try {
  const fsx = require('node:fs');
  const osx = require('node:os');
  const inspect = require(path.join(ROOT, 'src', 'memory', 'inspect.js'));
  const sroot = fsx.mkdtempSync(path.join(osx.tmpdir(), 'inspect-'));
  const sp = path.join(sroot, 'memory', 'chats', 'h1', 'people');
  fsx.mkdirSync(sp, { recursive: true });
  const legacy = 1000;                       // S2 之前
  const fresh = Date.now();
  fsx.writeFileSync(path.join(sp, 'p1.json'), JSON.stringify({
    version: 2, chatId: 'c1', uid: 'u1',
    events: [
      { id: 'd1', title: '工作', summary: '他在找工作', createdAt: fresh, source: { kind: 'group' } },
      { id: 'd2', title: '工作', summary: '他在找工作', createdAt: fresh, source: { kind: 'group' } },
      { id: 'l1', title: '旧', summary: '旧事件', createdAt: legacy, source: { chatId: 'c1' } },
      { id: 'n1', title: '新', summary: '没有来源的新事件', createdAt: fresh, source: { chatId: 'c1' } },
    ],
  }));
  fsx.writeFileSync(path.join(sp, 'broken.json'), '{ not json');
  fsx.writeFileSync(path.join(sp, 'p2.json'), JSON.stringify({
    version: 2, chatId: 'c1', uid: 'u2', events: [],
    preferences: Array.from({ length: 49 }, (_, i) => ({ id: 'p' + i, text: 'x', deleted: false })),
  }));
  const rep = inspect.scan({ dataDir: sroot });
  check('体检：重复事件', rep.dups === 1, String(rep.dups));
  check('体检：新数据缺来源', rep.noSource === 1 && rep.legacyNoSource === 1, rep.noSource + '/' + rep.legacyNoSource);
  check('体检：坏卡', rep.broken === 1, String(rep.broken));
  check('体检：超限卡', rep.overLimit === 1 && rep.ok === false, String(rep.overLimit));
} catch (e) {
  check('记忆体检', false, String(e && e.message).slice(0, 50));
}

// 牵挂 / 共情 / 复合情绪 / 表达 / 联系协调（R1–R5，2026-11-23）
try {
  const fsx = require('node:fs');
  const osx = require('node:os');
  const concerns = require(path.join(ROOT, 'src', 'core', 'concerns.js'));
  const empathy = require(path.join(ROOT, 'src', 'core', 'empathy.js'));
  const moodR = require(path.join(ROOT, 'src', 'core', 'mood.js'));
  const careR = require(path.join(ROOT, 'src', 'services', 'care.js'));
  const cdir = fsx.mkdtempSync(path.join(osx.tmpdir(), 'concern-'));
  const c1 = concerns.add(cdir, { text: '明天再说换工作的事', now: 1000 });
  concerns.add(cdir, { text: '明天再说换工作的事', now: 2000 });
  check('牵挂：写入去重', c1 && concerns.list(cdir, { now: 3000 }).length === 1, '');
  check('牵挂：注入文案', concerns.block({ dir: cdir, now: 3000 }).includes('欠着的'), '');
  concerns.close(cdir, '换工作', 4000);
  check('牵挂：可关闭', concerns.list(cdir, { now: 5000 }).length === 0, '');
  check('共情：生气安抚', empathy.assess('烦死了').tone === 'soothe', '');
  check('共情：忙时简短', empathy.assess('在开会').tone === 'brief', '');
  const stR = moodR.baseline(0);
  stR.emotions = { 喜: 0, 怒: 0.5, 哀: 0.6, 惧: 0, 爱: 0, 恶: 0, 欲: 0 };
  check('复合情绪：委屈', moodR.composite(stR) === '委屈', moodR.composite(stR));
  stR.emotions = { 喜: 0, 怒: 0.9, 哀: 0, 惧: 0, 爱: 0, 恶: 0, 欲: 0 };
  check('表达映射：怒→炸毛', moodR.expressionFor(stR) === '炸毛', '');
  const cfgR = { paths: { dataDir: cdir }, care: { enabled: true, everyMinutes: 1, followDesire: false } };
  const t0 = new Date(2026, 10, 23, 11, 0).getTime();
  const active = careR.careDue(cfgR, { lastSentTs: 0, sentToday: 0, now: t0, ownerActiveAt: t0 - 1000 });
  check('联系协调：主人在聊让位', active.due === false && active.reason === 'owner_active', active.reason);
  const boosted = careR.careDue(cfgR, { lastSentTs: t0 - 1000, sentToday: 0, now: t0, eventScore: 3 });
  check('联系协调：事件分可直接开口', boosted.due === true, boosted.reason);
  const noAns = careR.careDue(cfgR, { lastSentTs: t0 - 61000, sentToday: 0, now: t0 });
  const doubled = careR.careDue(cfgR, { lastSentTs: t0 - 61000, sentToday: 0, now: t0, unanswered: 1 });
  check('联系协调：未回冷却翻倍', noAns.due === true && doubled.due === false && doubled.reason === 'too_soon', noAns.reason + '/' + doubled.reason);
} catch (e) {
  check('牵挂账本', false, String(e && e.message).slice(0, 50));
}

// 画像 / 全局记忆 / 世界书 / 技能 / 反重复（I1–I5，2026-11-23）
try {
  const fsx = require('node:fs');
  const osx = require('node:os');
  const fmt3 = require(path.join(ROOT, 'src', 'memory', 'format.js'));
  const prompt3 = require(path.join(ROOT, 'src', 'persona', 'prompt.js'));
  const pg = require(path.join(ROOT, 'src', 'core', 'personGlobal.js'));
  const skills = require(path.join(ROOT, 'src', 'core', 'skills.js'));
  const anti = require(path.join(ROOT, 'src', 'core', 'antiRepeat.js'));
  const tr3 = pc.normalizeTrait({ text: '慢热', evidence: ['a', 'b', 'c'] }, 1);
  const tr1 = pc.normalizeTrait({ text: '爱猫', evidence: ['a'] }, 1);
  check('画像证据晋级', tr3.confirmed === true && tr1.confirmed === false, String(tr3.confirmed) + '/' + String(tr1.confirmed));
  const c3 = pc.normalizeCard({ version: 2, chatId: 'c', uid: 'u', traits: [
    { text: '未确认', confidence: 0.9, evidence: ['a'] },
    { text: '已确认', confidence: 0.6, evidence: ['a', 'b', 'c'] },
  ] }, { chatId: 'c' });
  const blk3 = fmt3.buildMemoryBlock({ card: c3, events: [], summary: '' });
  check('画像优先级排序', blk3.indexOf('已确认') < blk3.indexOf('未确认'), '');
  const gdir = fsx.mkdtempSync(path.join(osx.tmpdir(), 'global-'));
  pg.addFact(gdir, 'u1', '在武汉上班', { at: 1 });
  pg.addFact(gdir, 'u1', '在武汉上班', { at: 2 });
  check('全局记忆去重', pg.list(gdir, 'u1').length === 1, '');
  check('全局记忆隔离', pg.list(gdir, 'u2').length === 0 && pg.block({ dataDir: gdir, uid: 'u1' }).includes('跨会话印象'), '');
  const P3 = { world: [
    { key: '公司', text: '在光谷', keywords: ['上班', '公司'] },
    { key: '猫', text: '养了只橘猫', keywords: ['猫'] },
    { key: '房', text: '在租房', keywords: ['租'] },
    { key: '车', text: '没有车', keywords: ['车'] },
  ] };
  check('世界书命中', prompt3.worldBlock(P3, '今天上班好累').includes('光谷'), '');
  check('世界书不命中', prompt3.worldBlock(P3, '你好').length === 0, '');
  check('世界书最多三条', (prompt3.worldBlock(P3, '上班 猫 租 车').match(/：/g) || []).length === 3, '');
  skills.add(gdir, '改配置前先备份');
  skills.add(gdir, '改配置前先备份');
  check('技能结晶去重', skills.list(gdir).length === 1, '');
  check('技能匹配', skills.match(gdir, '帮我改配置').length === 1, '');
  check('反重复：用过换说法', anti.pick('好的', ['好的'], () => 0) === '好', '');
  check('反重复：没用过不动', anti.pick('好的', ['行'], () => 0) === '好的', '');
  check('反重复：长句不动', anti.pick('今天天气不错', ['今天天气不错'], () => 0) === '今天天气不错', '');
} catch (e) {
  check('画像证据晋级', false, String(e && e.message).slice(0, 50));
}

// careDecide 透传（R5 调用方，2026-11-23）
try {
  const careD = require(path.join(ROOT, 'src', 'services', 'care.js'));
  const nowD = new Date(2026, 10, 23, 11, 0).getTime();
  const cfgD = { paths: { dataDir: 'x' }, care: { enabled: true, everyMinutes: 1, followDesire: false,
    whitelist: ['wxid_x'], allowOthers: true, onlyMaster: false } };
  const blocked = careD.careDecide(cfgD, { now: nowD, ownerActiveAt: nowD - 1000 });
  check('careDecide 透传：主人在聊', blocked.due === false && blocked.reason === 'owner_active', blocked.reason);
  const boostedD = careD.careDecide(cfgD, { now: nowD, eventScore: 3 });
  check('careDecide 透传：事件分', boostedD.due === true && boostedD.target && boostedD.target.wxid === 'wxid_x', JSON.stringify(boostedD.target || null));
} catch (e) {
  check('careDecide 透传', false, String(e && e.message).slice(0, 40));
}

// Store 集成回归（复核修复，2026-11-23）
try {
  const fsx = require('node:fs');
  const osx = require('node:os');
  const { Store } = require(path.join(ROOT, 'src', 'memory', 'store.js'));
  const sroot = fsx.mkdtempSync(path.join(osx.tmpdir(), 'store-'));
  const dataDir = path.join(sroot, 'data');
  const store = new Store({
    file: path.join(dataDir, 'store.json'),
    dir: path.join(dataDir, 'memory'),
    config: { paths: { dataDir } },
    logger: null,
  });
  const key = 'wechat:u:u1';
  store.appendMessage(key, { role: 'user', uid: 'u1', name: 'n', text: '我住在武汉，在光谷上班', isMaster: true, isGroup: false });
  const msgs = store.messages(key, 5);
  check('Store 集成：消息保留 isMaster', msgs.length >= 1 && msgs[0].isMaster === true, JSON.stringify(msgs[0] && msgs[0].isMaster));
  const auditFile = path.join(dataDir, 'memory', 'audit.jsonl');
  const auditText = fsx.existsSync(auditFile) ? fsx.readFileSync(auditFile, 'utf8') : '';
  check('Store 集成：审计有写入', auditText.includes('"action":"add"'), auditText.slice(0, 60));
  const gdir = path.join(dataDir, 'memory', 'people-global');
  const gFiles = fsx.existsSync(gdir) ? fsx.readdirSync(gdir) : [];
  check('Store 集成：全局记忆有写入', gFiles.length >= 1, String(gFiles.length));
  // 牵挂默认 7 天过期
  const concerns2 = require(path.join(ROOT, 'src', 'core', 'concerns.js'));
  const croot = fsx.mkdtempSync(path.join(osx.tmpdir(), 'concern2-'));
  const nowC = new Date(2026, 10, 23, 10, 0).getTime();
  concerns2.add(croot, { text: '改天再说', now: nowC });
  check('牵挂默认 7 天过期', concerns2.list(croot, { now: nowC + 8 * 86400000 }).length === 0, '');
  // 极端情绪连续 3 次加速回落
  const moodX = require(path.join(ROOT, 'src', 'core', 'mood.js'));
  const stX = moodX.baseline(0);
  stX.emotions = { 喜: 0, 怒: 0.9, 哀: 0, 惧: 0, 爱: 0, 恶: 0, 欲: 0 };
  stX.scales = { 怒: 1.5 };
  moodX.dampIfExtreme(stX); moodX.dampIfExtreme(stX);
  check('极端情绪第三次加速回落', moodX.dampIfExtreme(stX) === true && stX.scales.怒 <= 0.8, String(stX.scales.怒));
} catch (e) {
  check('Store 集成', false, String(e && e.message).slice(0, 60));
}

// 睡眠后刷新缓存 + 事件分越过欲望闸门（复核修复，2026-11-23）
try {
  const fsx = require('node:fs');
  const osx = require('node:os');
  const { Store } = require(path.join(ROOT, 'src', 'memory', 'store.js'));
  const rroot = fsx.mkdtempSync(path.join(osx.tmpdir(), 'refresh-'));
  const rdata = path.join(rroot, 'data');
  const st2 = new Store({ file: path.join(rdata, 'store.json'), dir: path.join(rdata, 'memory'),
    config: { paths: { dataDir: rdata } }, logger: null });
  const key2 = 'wechat:u:u1';
  st2.appendMessage(key2, { role: 'user', uid: 'u1', name: '小明', text: '我叫小明', isMaster: true, isGroup: false });
  const chat2 = st2.chatStore.chats.get(key2);
  const beforeCard = chat2.people.get('u1');
  if (beforeCard) beforeCard.nickname = '内存脏值';
  st2.refreshCards();
  const afterCard = chat2.people.get('u1');
  check('刷新卡片缓存', Boolean(afterCard) && afterCard.nickname !== '内存脏值', String(afterCard && afterCard.nickname));
  const careD2 = require(path.join(ROOT, 'src', 'services', 'care.js'));
  const t0 = new Date(2026, 10, 23, 11, 0).getTime();
  const cdir2 = fsx.mkdtempSync(path.join(osx.tmpdir(), 'care2-'));
  fsx.writeFileSync(path.join(cdir2, 'mood.json'), JSON.stringify({ wants: { 见: 100, 听: 100, 香: 100, 味: 100, 触: 100, 意: 100 } }));
  const cfg2 = { paths: { dataDir: cdir2 }, care: { enabled: true, everyMinutes: 1, followDesire: true,
    whitelist: ['wxid_x'], allowOthers: true, onlyMaster: false } };
  const noBoost = careD2.careDue(cfg2, { now: t0, eventScore: 0 });
  const boost = careD2.careDue(cfg2, { now: t0, eventScore: 3 });
  check('事件分越过欲望闸门', noBoost.due === false && boost.due === true, (noBoost.reason || '') + '/' + (boost.reason || ''));
} catch (e) {
  check('刷新卡片缓存', false, String(e && e.message).slice(0, 50));
}

// 复核完善回归（2026-11-23 02:10）
try {
  const fsx = require('node:fs');
  const osx = require('node:os');
  // 睡眠任务写审计
  const sroot = fsx.mkdtempSync(path.join(osx.tmpdir(), 'sleepaudit-'));
  const sp = path.join(sroot, 'memory', 'chats', 'h1', 'people');
  fsx.mkdirSync(sp, { recursive: true });
  const nowS = new Date(2026, 10, 23, 10, 0).getTime();
  fsx.writeFileSync(path.join(sp, 'p1.json'), JSON.stringify({ version: 2, chatId: 'c1', uid: 'u1', events: [
    { id: 'x1', title: '工作', summary: '他在找工作', createdAt: nowS - 2 * 86400000, importance: 0.5, layer: 'L1' },
    { id: 'x2', title: '工作', summary: '他在找工作', createdAt: nowS - 86400000, importance: 0.5, layer: 'L1' },
  ] }));
  const sleep2 = require(path.join(ROOT, 'src', 'services', 'memorySleep.js'));
  sleep2.run({ dataDir: sroot, now: nowS });
  const auditText = fsx.readFileSync(path.join(sroot, 'memory', 'audit.jsonl'), 'utf8');
  check('睡眠审计留痕', auditText.includes('"reason":"sleep"'), auditText.slice(0, 50));
  // 全局记忆过滤：taboo 不进全局，fact 进
  const { Store } = require(path.join(ROOT, 'src', 'memory', 'store.js'));
  const groot = fsx.mkdtempSync(path.join(osx.tmpdir(), 'globalf-'));
  const gdata = path.join(groot, 'data');
  const st3 = new Store({ file: path.join(gdata, 'store.json'), dir: path.join(gdata, 'memory'),
    config: { paths: { dataDir: gdata } }, logger: null });
  const gkey = 'wechat:u:u2';
  st3.appendMessage(gkey, { role: 'user', uid: 'u2', name: 'n', text: '我不吃香菜', isMaster: true, isGroup: false });
  st3.appendMessage(gkey, { role: 'user', uid: 'u2', name: 'n', text: '我住在武汉', isMaster: true, isGroup: false });
  const pg2 = require(path.join(ROOT, 'src', 'core', 'personGlobal.js'));
  const allFacts = pg2.list(gdata, 'u2', 20).map((f) => f.text).join('|');
  check('全局记忆过滤 taboo', !allFacts.includes('香菜'), allFacts);
  check('全局记忆保留事实', allFacts.includes('武汉'), allFacts);
  // 技能提示
  const sk2 = require(path.join(ROOT, 'src', 'core', 'skills.js'));
  const kdir = fsx.mkdtempSync(path.join(osx.tmpdir(), 'skillb-'));
  sk2.add(kdir, '改配置前先备份');
  check('技能提示块', sk2.block({ dataDir: kdir, text: '帮我改配置' }).includes('以前做过'), '');
  // 反重复新表
  const anti2 = require(path.join(ROOT, 'src', 'core', 'antiRepeat.js'));
  check('反重复新短句', anti2.pick('知道了', ['知道了'], () => 0) === '嗯嗯', '');
} catch (e) {
  check('复核完善回归', false, String(e && e.message).slice(0, 60));
}

// 改称呼识别（2026-11-24 断片修复）
try {
  const nick = require(path.join(ROOT, 'src', 'core', 'nickname.js'));
  check('改称呼：接受新名字', nick.hint('以后叫你哦鲸鲸').includes('哦鲸鲸'), nick.hint('以后叫你哦鲸鲸'));
  check('改称呼：以后就叫', nick.hint('以后就叫你鲸鲸吧').includes('鲸鲸'), '');
  check('改称呼：不叫旧名', nick.hint('以后不叫你大肥鱼了').includes('不想再叫'), '');
  check('改称呼：普通消息不触发', nick.hint('今天吃什么') === '', '');
} catch (e) {
  check('改称呼识别', false, String(e && e.message).slice(0, 40));
}

// 第一期记忆可靠性（2026-11-24）
try {
  const fsx = require('node:fs');
  const osx = require('node:os');
  const { Store } = require(path.join(ROOT, 'src', 'memory', 'store.js'));
  const base = fsx.mkdtempSync(path.join(osx.tmpdir(), 'p1-'));
  const mk = () => new Store({
    file: path.join(base, 'store.json'), dir: path.join(base, 'memory'),
    config: { paths: { dataDir: base }, persona: { master: { wxids: ['m1'], names: ['主人'] } } },
    logger: null,
  });
  const st = mk();
  const masterMsg = { platform: 'wechat', chatType: 'private', chatId: 'm1', senderId: 'm1', senderName: '主人' };
  const otherMsg = { platform: 'wechat', chatType: 'private', chatId: 'u9', senderId: 'u9', senderName: '别人' };
  st.recordUser('wechat:u:m1', masterMsg, '我住在武汉');
  st.recordUser('wechat:u:u9', otherMsg, '我喜欢橘子');
  const m1rows = st.messages('wechat:u:m1', 5);
  const u9rows = st.messages('wechat:u:u9', 5);
  check('统一写入口：主人标记', m1rows[0] && m1rows[0].isMaster === true, String(m1rows[0] && m1rows[0].isMaster));
  check('统一写入口：非主人标记', u9rows[0] && u9rows[0].isMaster === false, String(u9rows[0] && u9rows[0].isMaster));
  st.noteWriteFailure('user', new Error('disk full'));
  st.noteWriteFailure('user', new Error('disk full'));
  check('写失败计数', st.writeFailures.total === 2 && st.writeFailures.consecutive === 2, JSON.stringify(st.writeFailures));
  st.recordUser('wechat:u:m1', masterMsg, '我住在武汉');
  check('写成功后清零', st.writeFailures.consecutive === 0 && st.writeFailures.total === 2, JSON.stringify(st.writeFailures));
  const sleep3 = require(path.join(ROOT, 'src', 'services', 'memorySleep.js'));
  const sroot = fsx.mkdtempSync(path.join(osx.tmpdir(), 'p1s-'));
  const chatDir = path.join(sroot, 'memory', 'chats', 'abc');
  fsx.mkdirSync(chatDir, { recursive: true });
  const lines = [JSON.stringify({ seq: 1, role: 'user', text: '你好' })];
  for (let i = 2; i <= 9; i += 1) lines.push(JSON.stringify({ seq: i, role: 'assistant', text: '回' + i }));
  fsx.writeFileSync(path.join(chatDir, 'messages.jsonl'), lines.join('\n'));
  const health3 = sleep3.auditChats(sroot);
  check('每日对账：发现断片', health3.stale.length === 1 && health3.stale[0].assistantsAfterLastUser === 8, JSON.stringify(health3.stale));
  const ex3 = require(path.join(ROOT, 'src', 'memory', 'extractor.js'));
  check('前缀抽取：对了', ex3.extractSelfFacts('对了，我住在武汉').facts.length === 1, '');
} catch (e) {
  check('第一期记忆可靠性', false, String(e && e.message).slice(0, 60));
}

// 第二期：最近 user 保底 + 改称呼持久化（2026-11-24）
try {
  const fsx = require('node:fs');
  const osx = require('node:os');
  const comp = require(path.join(ROOT, 'src', 'memory', 'compression.js'));
  const msgs = [];
  let seq = 0;
  for (let u = 1; u <= 4; u += 1) {
    seq += 1; msgs.push({ seq, role: 'user', text: '用户问题' + u, ts: 1, uid: 'u1', name: 'n' });
    for (let a = 0; a < 4; a += 1) { seq += 1; msgs.push({ seq, role: 'assistant', text: '她的回复' + seq, ts: 2 }); }
  }
  const fakeChat = { messages: msgs, summary: { coveredThroughSeq: 0 } };
  const recent = comp.recentForPrompt(fakeChat, { currentSeq: 0, maxTokens: 5, maxCount: 40, minUser: 4 });
  const userCount = recent.messages.filter((m) => m.role === 'user').length;
  check('最近用户消息保底', userCount === 4, 'user=' + userCount + ' tokens=' + recent.tokens);
  const nick2 = require(path.join(ROOT, 'src', 'core', 'nickname.js'));
  const ndir = fsx.mkdtempSync(path.join(osx.tmpdir(), 'nick-'));
  nick2.remember(ndir, 'wechat:u:m1', '以后叫你哦鲸鲸', 1);
  check('改称呼持久化', nick2.current(ndir, 'wechat:u:m1') === '哦鲸鲸', nick2.current(ndir, 'wechat:u:m1'));
  nick2.remember(ndir, 'wechat:u:m1', '以后不叫你大肥鱼了', 2);
  check('不叫旧名不覆盖', nick2.current(ndir, 'wechat:u:m1') === '哦鲸鲸', '');
  check('改称呼提取', nick2.extract('以后就叫你鲸鲸吧').name === '鲸鲸', JSON.stringify(nick2.extract('以后就叫你鲸鲸吧')));
} catch (e) {
  check('最近用户消息保底', false, String(e && e.message).slice(0, 60));
}

// 第二期：定期摘要 + 指代提示（2026-11-24）
try {
  const comp2 = require(path.join(ROOT, 'src', 'memory', 'compression.js'));
  const mkChat = (n) => {
    const messages = [];
    for (let i = 1; i <= n; i += 1) messages.push({ seq: i, role: i % 2 ? 'user' : 'assistant', text: '消息' + i, ts: i, uid: 'u1', name: 'n' });
    return { messages, meta: {}, summary: { segments: [], coveredThroughSeq: 0 } };
  };
  const chatA = mkChat(35);
  const nowT = new Date(2026, 10, 24, 2, 0).getTime();
  const r1 = comp2.timedCompress(chatA, { now: nowT, minNew: 30, intervalMs: 2 * 3600000 });
  check('定期摘要：触发', r1.chunks === 1 && chatA.summary.coveredThroughSeq === 15, JSON.stringify(r1));
  const r2 = comp2.timedCompress(chatA, { now: nowT + 60000, minNew: 30, intervalMs: 2 * 3600000 });
  check('定期摘要：间隔内不重复', r2.chunks === 0, '');
  const chatB = mkChat(10);
  check('定期摘要：条数不足不动', comp2.timedCompress(chatB, { now: nowT }).chunks === 0, '');
  const coref2 = require(path.join(ROOT, 'src', 'core', 'coref.js'));
  check('指代提示', coref2.hint('刚才那个事怎么样了').includes('指代') && coref2.hint('今天吃什么') === '', '');
} catch (e) {
  check('定期摘要', false, String(e && e.message).slice(0, 50));
}

// 第三期：意图分类（2026-11-24）
try {
  const it = require(path.join(ROOT, 'src', 'core', 'intent.js'));
  check('意图：派活', it.classify('帮我查一下明天天气') === 'delegate', it.classify('帮我查一下明天天气'));
  check('意图：提醒', it.classify('明天记得提醒我交表') === 'remind', it.classify('明天记得提醒我交表'));
  check('意图：提问', it.classify('你为什么这么晚睡？') === 'question', it.classify('你为什么这么晚睡？'));
  check('意图：闲聊', it.classify('今天天气不错') === 'chat' && it.hint('今天天气不错') === '', '');
} catch (e) {
  check('意图分类', false, String(e && e.message).slice(0, 40));
}

// 第三期：pin + 复杂路由（2026-11-24）
try {
  const fsx = require('node:fs');
  const osx = require('node:os');
  const pins = require(path.join(ROOT, 'src', 'core', 'pins.js'));
  const pdir = fsx.mkdtempSync(path.join(osx.tmpdir(), 'pins-'));
  const items = pins.detect('说好了每周三一起看电影，雷点是不准提香菜');
  check('pin 识别', items.some((x) => x.kind === '约定') && items.some((x) => x.kind === '雷点'), JSON.stringify(items));
  pins.add(pdir, 'wechat:u:m1', items, 1);
  pins.add(pdir, 'wechat:u:m1', items, 2);
  check('pin 去重', pins.list(pdir, 'wechat:u:m1', 10).length === 2, '');
  check('pin 注入', pins.block({ dataDir: pdir, chatId: 'wechat:u:m1' }).includes('约定'), '');
  check('pin 不误收日常', pins.detect('每天都很累').length === 0 && pins.detect('别问我为什么').length === 0, JSON.stringify(pins.detect('每天都很累')));
  const route3 = require(path.join(ROOT, 'src', 'core', 'route.js'));
  check('路由：关闭不动', route3.isComplex('写一段代码', { enabled: false, keywords: ['代码'] }) === false, '');
  check('路由：关键词命中', route3.isComplex('帮我写一段代码', { enabled: true, keywords: ['代码'] }) === true, '');
  check('路由：长文命中', route3.isComplex('x'.repeat(201), { enabled: true, minChars: 200 }) === true, '');
} catch (e) {
  check('关键事实 pin', false, String(e && e.message).slice(0, 50));
}

// 第三期：预算自适应（2026-11-24）
try {
  const bp = require(path.join(ROOT, 'src', 'memory', 'budgetPlan.js'));
  check('预算自适应：短会话不变', bp.adaptiveBudget(8000, 100) === 8000, String(bp.adaptiveBudget(8000, 100)));
  check('预算自适应：150 条', bp.adaptiveBudget(8000, 150) === 10000, String(bp.adaptiveBudget(8000, 150)));
  check('预算自适应：300 条', bp.adaptiveBudget(8000, 300) === 12000, String(bp.adaptiveBudget(8000, 300)));
  check('预算自适应：可关闭', bp.adaptiveBudget(8000, 300, false) === 8000, '');
  check('预算自适应：记忆块变大', bp.planBudget(12000).memory > bp.planBudget(8000).memory, '');
} catch (e) {
  check('预算自适应', false, String(e && e.message).slice(0, 40));
}

// 备份覆盖与恢复（2026-11-24 复核）
try {
  const fsx = require('node:fs');
  const osx = require('node:os');
  const backup = require(path.join(ROOT, 'src', 'memory', 'backup.js'));
  const rootA = fsx.mkdtempSync(path.join(osx.tmpdir(), 'bakA-'));
  const dataA = path.join(rootA, 'data');
  fsx.mkdirSync(path.join(dataA, 'memory'), { recursive: true });
  fsx.writeFileSync(path.join(dataA, 'pins.json'), JSON.stringify({ c1: [{ kind: '约定', text: '每周三看电影' }] }));
  fsx.writeFileSync(path.join(dataA, 'nicknames.json'), JSON.stringify({ c1: { name: '哦鲸鲸' } }));
  fsx.writeFileSync(path.join(dataA, 'concerns.json'), JSON.stringify({ items: [] }));
  fsx.writeFileSync(path.join(dataA, 'skills.md'), '- [11-24] 改配置前先备份\n');
  fsx.writeFileSync(path.join(dataA, 'mood.json'), JSON.stringify({ emotions: { 喜: 1 } }));
  fsx.writeFileSync(path.join(dataA, 'thoughts.json'), JSON.stringify({ items: [{ text: '念头' }] }));
  const bundle = backup.collect(rootA);
  check('备份覆盖新文件', Boolean(bundle.files.pins && bundle.files.nicknames && bundle.files.concerns && bundle.files.skills && bundle.files.mood && bundle.files.thoughts), Object.keys(bundle.files).join(','));
  const rootB = fsx.mkdtempSync(path.join(osx.tmpdir(), 'bakB-'));
  fsx.mkdirSync(path.join(rootB, 'data'), { recursive: true });
  backup.restoreFrom(rootB, bundle);
  const restored = fsx.readFileSync(path.join(rootB, 'data', 'pins.json'), 'utf8');
  const restoredSkill = fsx.readFileSync(path.join(rootB, 'data', 'skills.md'), 'utf8');
  check('恢复新文件', restored.includes('每周三看电影') && restoredSkill.includes('先备份'), '');
  const moodB = JSON.parse(fsx.readFileSync(path.join(rootB, 'data', 'mood.json'), 'utf8'));
  const thoughtsB = JSON.parse(fsx.readFileSync(path.join(rootB, 'data', 'thoughts.json'), 'utf8'));
  check('恢复情绪/念头', moodB.emotions && moodB.emotions.喜 === 1 && thoughtsB.items && thoughtsB.items[0].text === '念头', '');
} catch (e) {
  check('备份覆盖新文件', false, String(e && e.message).slice(0, 60));
}

// 睡眠日期必须按本地时区（2026-11-24 实测 bug）
try {
  const ms = require(path.join(ROOT, 'src', 'services', 'memorySleep.js'));
  const localNight = new Date(2026, 10, 24, 0, 30).getTime();
  check('睡眠日期用本地时区', ms.dayKey(localNight) === '2026-11-24', ms.dayKey(localNight));
  const localMorning = new Date(2026, 10, 24, 7, 46).getTime();
  check('睡眠日期上午仍是当天', ms.dayKey(localMorning) === '2026-11-24', ms.dayKey(localMorning));
} catch (e) {
  check('睡眠日期用本地时区', false, String(e && e.message).slice(0, 40));
}

// 一期/二期：silent 补录 + 动态提示预算（2026-11-24）
try {
  const fsx = require('node:fs');
  const osx = require('node:os');
  const { Store } = require(path.join(ROOT, 'src', 'memory', 'store.js'));
  const root4 = fsx.mkdtempSync(path.join(osx.tmpdir(), 'silent-'));
  const mk4 = () => new Store({ file: path.join(root4, 'store.json'), dir: path.join(root4, 'memory'),
    config: { paths: { dataDir: root4 } }, logger: null });
  const st4 = mk4();
  const key4 = 'wechat:u:u1';
  st4.appendMessage(key4, { role: 'user', uid: 'u1', name: 'n', text: '我住在武汉', silent: true });
  const chat4 = st4.chatStore.chats.get(key4);
  const card4 = chat4.people.get('u1');
  check('silent 补录：不抽事实', !card4 || (card4.preferences || []).length === 0, String(card4 && (card4.preferences || []).length));
  st4.appendMessage(key4, { role: 'user', uid: 'u1', name: 'n', text: '我住在武汉' });
  check('silent 补录：正常仍抽', (chat4.people.get('u1').preferences || []).length >= 1, '');
  const pb = require(path.join(ROOT, 'src', 'core', 'promptBudget.js'));
  const small = pb.fitBlocks([{ key: 'mood', text: '心情' }, { key: 'pin', text: '记着' }]);
  check('动态预算：不超不动', small.includes('心情') && small.includes('记着'), small);
  const big = pb.fitBlocks([
    { key: 'mood', text: '心'.repeat(400) }, { key: 'pin', text: '记'.repeat(400) },
    { key: 'skill', text: '技'.repeat(400) }, { key: 'coref', text: '指'.repeat(400) },
  ], { maxChars: 1000 });
  check('动态预算：裁剪', big.length <= 1000 && !big.includes('技'), String(big.length));
} catch (e) {
  check('silent 补录', false, String(e && e.message).slice(0, 60));
}

// 向量/嵌入路径不依赖 cwd（2026-11-24 架构体检）
try {
  const embed = require(path.join(ROOT, 'src', 'core', 'embed.js'));
  const vi = require(path.join(ROOT, 'src', 'memory', 'vectorIndex.js'));
  const rootPath = path.dirname(path.dirname(ROOT)); // ROOT 的上一级（dist/whale-personal 或 repo）
  const norm = (x) => String(x).replace(/\\/g, '/').toLowerCase();
  check('向量路径不依赖 cwd：embed', norm(embed.VEC_DIR).includes('/data/vector') && norm(embed.VEC_DIR).startsWith(norm(path.dirname(ROOT)).toLowerCase() + '/'), embed.VEC_DIR);
  check('向量路径不依赖 cwd：cache', norm(vi.CACHE_FILE).includes('/data/vector/event-vecs.json'), vi.CACHE_FILE);
} catch (e) {
  check('向量路径不依赖 cwd', false, String(e && e.message).slice(0, 50));
}

// 浏览器缓存清理（2026-11-24 架构体检）
try {
  const fsx = require('node:fs');
  const osx = require('node:os');
  const bpc = require(path.join(ROOT, 'src', 'adapters', 'browserProfileCleanup.js'));
  const dir = fsx.mkdtempSync(path.join(osx.tmpdir(), 'bpc-'));
  fsx.mkdirSync(path.join(dir, 'Default', 'Cache'), { recursive: true });
  fsx.writeFileSync(path.join(dir, 'Default', 'Cache', 'a.bin'), 'x'.repeat(20));
  fsx.writeFileSync(path.join(dir, 'Default', 'Cookies'), 'keep');
  fsx.mkdirSync(path.join(dir, 'component_crx_cache'), { recursive: true });
  fsx.writeFileSync(path.join(dir, 'component_crx_cache', 'old.bin'), 'x'.repeat(20));
  const old = (Date.now() - 10 * 86400000) / 1000;
  fsx.utimesSync(path.join(dir, 'component_crx_cache'), old, old);
  fsx.mkdirSync(path.join(dir, 'WasmTtsEngine'), { recursive: true });
  fsx.writeFileSync(path.join(dir, 'WasmTtsEngine', 'new.bin'), 'x');
  const r = bpc.cleanup(dir, { maxAgeDays: 7 });
  check('浏览器缓存清理：删缓存', !fsx.existsSync(path.join(dir, 'Default', 'Cache')), JSON.stringify(r));
  check('浏览器缓存清理：保留登录', fsx.existsSync(path.join(dir, 'Default', 'Cookies')), '');
  check('浏览器缓存清理：旧组件删/新组件留', !fsx.existsSync(path.join(dir, 'component_crx_cache')) && fsx.existsSync(path.join(dir, 'WasmTtsEngine')), '');
} catch (e) {
  check('浏览器缓存清理', false, String(e && e.message).slice(0, 50));
}

// episode 关闭保留尾部原文（2026-11-24 摘要体检）
try {
  const ep = require(path.join(ROOT, 'src', 'memory', 'episode.js'));
  check('episode 保留尾部原文', ep.episodeCoverageTo({ messageSeqFrom: 10, messageSeqTo: 100 }, 8) === 92, String(ep.episodeCoverageTo({ messageSeqFrom: 10, messageSeqTo: 100 }, 8)));
  check('episode 短段不越界', ep.episodeCoverageTo({ messageSeqFrom: 10, messageSeqTo: 12 }, 8) === 10, '');
} catch (e) {
  check('episode 保留尾部原文', false, String(e && e.message).slice(0, 40));
}

// 摘要覆盖后仍保留最近原文（2026-11-24 prompt 体检）
try {
  const compT = require(path.join(ROOT, 'src', 'memory', 'compression.js'));
  const msgs = [];
  for (let i = 1; i <= 20; i += 1) msgs.push({ seq: i, role: i % 2 ? 'user' : 'assistant', text: '消息' + i, ts: 1, uid: 'u1', name: 'n' });
  const chatT = { messages: msgs, summary: { coveredThroughSeq: 20 } };
  const rT = compT.recentForPrompt(chatT, { currentSeq: 0, maxTokens: 10000, maxCount: 40 });
  check('最近原文保底：摘要全覆盖仍有尾部', rT.messages.length === 8 && rT.messages[0].seq === 13, String(rT.messages.length) + '/' + (rT.messages[0] && rT.messages[0].seq));
} catch (e) {
  check('最近原文保底', false, String(e && e.message).slice(0, 50));
}

// 媒体缓存 kept 统计（2026-11-24）
try {
  const fsx = require('node:fs');
  const osx = require('node:os');
  const mc = require(path.join(ROOT, 'src', 'adapters', 'mediaCache.js'));
  const dir = fsx.mkdtempSync(path.join(osx.tmpdir(), 'mc-'));
  for (let i = 0; i < 5; i += 1) fsx.writeFileSync(path.join(dir, 'f' + i + '.bin'), 'x'.repeat(400 * 1024));
  const r = mc.cleanup(dir, { maxAgeDays: 3650, maxTotalMB: 1, now: Date.now() });
  const left = fsx.readdirSync(dir).length;
  check('媒体缓存：kept 统计', r.kept === left && r.removed + left === 5, JSON.stringify(r) + '/left=' + left);
} catch (e) {
  check('媒体缓存：kept 统计', false, String(e && e.message).slice(0, 50));
}

// summary 裁剪折叠后 coverage 不留洞（2026-11-24）
try {
  const compS = require(path.join(ROOT, 'src', 'memory', 'compression.js'));
  const long = '甲'.repeat(400);
  const chatS = { summary: { segments: [
    { text: long, fromSeq: 1, toSeq: 100, tokens: 400 },
    { text: long, fromSeq: 101, toSeq: 200, tokens: 400 },
    { text: long, fromSeq: 201, toSeq: 300, tokens: 400 },
  ], coveredThroughSeq: 300 } };
  compS.trimSummary(chatS, { summaryTokens: 120 });
  const seg = chatS.summary.segments[0];
  check('summary 裁剪不留洞', chatS.summary.coveredThroughSeq === 300 && seg.fromSeq === 1 && seg.toSeq === 300, JSON.stringify({ covered: chatS.summary.coveredThroughSeq, from: seg.fromSeq, to: seg.toSeq }));
} catch (e) {
  check('summary 裁剪不留洞', false, String(e && e.message).slice(0, 50));
}

// 日志/追踪保留策略（2026-11-24）
try {
  const fsx = require('node:fs');
  const osx = require('node:os');
  const ret = require(path.join(ROOT, 'src', 'infra', 'retention.js'));
  const dir = fsx.mkdtempSync(path.join(osx.tmpdir(), 'ret-'));
  const logs = path.join(dir, 'logs'); const trace = path.join(dir, 'trace');
  fsx.mkdirSync(path.join(logs, 'run-old'), { recursive: true });
  fsx.mkdirSync(path.join(logs, 'run-new'), { recursive: true });
  fsx.mkdirSync(trace, { recursive: true });
  fsx.writeFileSync(path.join(trace, 'old.jsonl'), 'x');
  fsx.writeFileSync(path.join(trace, 'new.jsonl'), 'x');
  const old = (Date.now() - 20 * 86400000) / 1000;
  fsx.utimesSync(path.join(logs, 'run-old'), old, old);
  fsx.utimesSync(path.join(trace, 'old.jsonl'), old, old);
  const r1 = ret.pruneOldDirs(logs, { prefix: 'run-', maxAgeDays: 14 });
  const r2 = ret.pruneOldFiles(trace, { maxAgeDays: 14 });
  check('日志保留策略：旧目录删', r1 === 1 && !fsx.existsSync(path.join(logs, 'run-old')) && fsx.existsSync(path.join(logs, 'run-new')), String(r1));
  check('日志保留策略：旧追踪删', r2 === 1 && !fsx.existsSync(path.join(trace, 'old.jsonl')) && fsx.existsSync(path.join(trace, 'new.jsonl')), String(r2));
} catch (e) {
  check('日志保留策略', false, String(e && e.message).slice(0, 50));
}

// 摘要单段超限保留最近内容（2026-11-24 摘要体检）
try {
  const compT2 = require(path.join(ROOT, 'src', 'memory', 'compression.js'));
  const chatT2 = { summary: { segments: [
    { text: '旧'.repeat(1000) + '最近的关键事：主人换了工作', fromSeq: 1, toSeq: 100, tokens: 1000 },
  ], coveredThroughSeq: 100 } };
  compT2.trimSummary(chatT2, { summaryTokens: 100 });
  const out = chatT2.summary.segments[0].text;
  check('摘要超限保留最近', out.includes('最近的关键事') && !out.startsWith('旧旧'), out.slice(0, 30));
} catch (e) {
  check('摘要超限保留最近', false, String(e && e.message).slice(0, 40));
}

console.log('\n通过 ' + pass + '/' + (pass + fail));
  process.exit(fail ? 1 : 0);
})();
