'use strict';
/**
 * 情绪状态机 —— 三轴 + 七情 + 六欲 + 耦合 + 反刍（P1/P2/P3）
 *
 * 三轴（沿用旧版，别的模块在读）：
 *   valence 愉快度 -1..1（基线 0.10）· arousal 激活度 0..1（0.35）· energy 精力 0..1（0.60）
 *   半衰期 40 分钟向基线回落。
 *
 * 七情（P1）：喜 怒 哀 惧 爱 恶 欲，各自 0..1，各有自己的半衰期。
 * 六欲（P2）：见 听 香 味 触 意，各自 0..100，每小时自己掉（线性，不是半衰期）。
 *
 * 这一版的三个要点：
 *   1) **所有增量、掉速都在区间里随机**——同一个信号两次，痕迹深浅不一样，不像查表；
 *   2) **反刍**：同一情绪 40 分钟内再次被点亮，这段余波的半衰期再拉长 1.28~1.38 倍（上限 2.5）；
 *   3) **耦合**：六欲长期低下会把情绪往下压，单次联动封顶 ±0.03，不会被一句话带崩。
 *
 * 随机源可注入（rng 参数，默认 Math.random）；测试传 () => 0.5 取区间中点即可复现。
 * 存储：data/mood.json（几百字节，原子写；写失败只丢惯性，不影响这一轮回复）。
 */

const fs = require('node:fs');
const path = require('node:path');

const BASELINE = Object.freeze({ valence: 0.1, arousal: 0.35, energy: 0.6 });
const HALF_LIFE_MS = 40 * 60 * 1000;
const VERSION = 4;

const PRAISE = /好乖|真乖|可爱|真棒|厉害|喜欢你|爱你|谢谢|辛苦了|做得好|不错|完美|靠谱|真好(?!奇)|乖/;
const INSULT = /笨|蠢|垃圾|废物|滚(?!动|筒|轮|烫|珠)|闭嘴|烦人|讨厌你|没用|傻|菜(?![价市单谱码])|拉胯|离谱|气死/;
const AFFECTION = /么么|抱抱|亲亲|贴贴|想你|摸摸|揉揉|蹭蹭/;
const COLD = /哦|嗯|随便|无所谓|算了|不想说|没事/;
const PRESSURE = /快点|赶紧|马上|怎么还没|怎么搞的|你行不行/;

function clamp(v, lo, hi) {
  if (!Number.isFinite(v)) return lo;
  return Math.min(hi, Math.max(lo, v));
}

function round(v) {
  return Math.round(v * 1000) / 1000;
}

/** 区间随机：rng 缺省 Math.random；同一个函数里连续取，落点各不相同 */
function rand(rng, lo, hi) {
  const raw = typeof rng === 'function' ? rng() : Math.random();
  const x = Number.isFinite(raw) ? clamp(raw, 0, 1) : 0.5;
  return lo + (hi - lo) * x;
}

/** 三轴的增量也是区间（不再是 0.10 这种死数） */
const AXIS_RANGE = Object.freeze({
  praise: { valence: [0.08, 0.12], arousal: [0.04, 0.06], energy: [0.02, 0.04] },
  insult: { valence: [-0.16, -0.12], arousal: [0.10, 0.14], energy: [-0.03, -0.01] },
  affection: { valence: [0.10, 0.14], arousal: [0.07, 0.09] },
  cold: { valence: [-0.05, -0.03], arousal: [-0.07, -0.05] },
  pressure: { valence: [-0.06, -0.04], arousal: [0.09, 0.11] },
  longText: { arousal: [0.03, 0.05], energy: [0.01, 0.03] },
});

/* ------------------------------------------------------------------ 七情 */

const EMOTIONS = Object.freeze(['喜', '怒', '哀', '惧', '爱', '恶', '欲']);

const EMOTION_HALF_LIFE_MS = Object.freeze({
  喜: 40 * 60 * 1000,
  怒: 20 * 60 * 1000,
  哀: 4 * 60 * 60 * 1000,
  惧: 30 * 60 * 1000,
  爱: 5 * 60 * 60 * 1000,
  恶: 2 * 60 * 60 * 1000,
  欲: 5 * 60 * 60 * 1000,
});

/** 一次事件给某条情绪的增量区间 */
const EMOTION_RANGE = Object.freeze({
  喜: [0.20, 0.30],
  怒: [0.14, 0.22],
  哀: [0.09, 0.15],
  惧: [0.03, 0.07],
  爱: [0.16, 0.24],
  恶: [0.14, 0.22],
  欲: [0.09, 0.15],
});

/** 被催促时的怒增量（比被骂轻，单独一条，免得藏魔法数字） */
const PRESSURE_ANGER_RANGE = Object.freeze([0.08, 0.12]);

/** 给提示词用的人话（不报数值） */
const EMOTION_LINES = Object.freeze({
  喜: '有点高兴',
  怒: '有点生气',
  哀: '有点难过',
  惧: '有点不安',
  爱: '心里软软的',
  恶: '有点烦',
  欲: '想被人陪一下',
});

/** 一次事件之后，这段情绪的衰减尺度（越大 = 余波挂得越久） */
const SCALE_RANGE = [0.8, 1.25];
/** 反刍：同一情绪在窗口内再次被点亮，尺度再乘这个区间 */
const RUMINATION_WINDOW_MS = 40 * 60 * 1000;
const RUMINATION_RANGE = [1.28, 1.38];
const RUMINATION_MAX = 2.5;
/** 每次衰减时再叠一点随机（0.9~1.1），避免固定节拍 */
const DECAY_JITTER = [0.9, 1.1];

function emptyEmotions() {
  const out = {};
  for (const name of EMOTIONS) out[name] = 0;
  return out;
}

function emotionsOf(state) {
  const out = emptyEmotions();
  const src = state && typeof state === 'object' && state.emotions && typeof state.emotions === 'object'
    ? state.emotions
    : null;
  if (!src) return out;
  for (const name of EMOTIONS) out[name] = round(clamp(Number(src[name]) || 0, 0, 1));
  return out;
}

/** 每条情绪的衰减尺度；没有就按 1 */
function scalesOf(state) {
  const out = {};
  const src = state && typeof state === 'object' && state.scales && typeof state.scales === 'object' ? state.scales : null;
  for (const name of EMOTIONS) {
    const value = src ? Number(src[name]) : NaN;
    out[name] = Number.isFinite(value) && value > 0 ? clamp(value, 0.5, RUMINATION_MAX) : 1;
  }
  return out;
}

function decayEmotions(emotions, dtMs, { rng = Math.random, scales = null } = {}) {
  const out = {};
  const scaleMap = scales || {};
  for (const name of EMOTIONS) {
    const value = Number(emotions[name]) || 0;
    const scale = Number(scaleMap[name]) > 0 ? Number(scaleMap[name]) : 1;
    const half = EMOTION_HALF_LIFE_MS[name] * scale * rand(rng, DECAY_JITTER[0], DECAY_JITTER[1]);
    out[name] = round(value * Math.pow(0.5, Math.max(0, dtMs) / half));
  }
  return out;
}

function topEmotions(state, limit = 2) {
  const e = emotionsOf(state);
  return EMOTIONS
    .map((name) => ({ name, value: e[name] }))
    .filter((item) => item.value >= 0.15)
    .sort((a, b) => b.value - a.value)
    .slice(0, Math.max(0, limit));
}

function emotionLabel(state) {
  const top = topEmotions(state, 1)[0];
  return top ? EMOTION_LINES[top.name] : '';
}

/* ------------------------------------------------------------------ 六欲 */

const WANTS = Object.freeze(['见', '听', '香', '味', '触', '意']);
const WANT_BASE = Object.freeze({ 见: 60, 听: 60, 香: 60, 味: 60, 触: 60, 意: 60 });
/** 六欲上限：250（200 太容易被刷满，尤其是意） */
const WANT_MAX = 250;

/**
 * 学习：次数上限 + 每次增量（增量是区间，上限是「次数」不是数值）
 *  - 自主刷抖音/上网：每天最多 200 次计学习
 *  - 主人分享：每天最多 100 次计学习
 * 超过次数上限不再涨「意」，但仍可继续看/分享。
 */
const LEARN_CAP = Object.freeze({ auto: 200, owner: 100 });
const LEARN_GAIN = Object.freeze({ auto: [25, 50], owner: [10, 20] });

/** 每小时掉多少（区间） */
const WANT_DECAY_RANGE = Object.freeze({
  见: [3.6, 4.4],
  听: [3.6, 4.4],
  香: [2.7, 3.3],
  味: [6.3, 7.7],
  触: [5.4, 6.6],
  意: [4.5, 5.5],
});

/** 喂一口回多少（区间） */
const WANT_FEED_RANGE = Object.freeze({
  见: [9, 15],
  听: [9, 15],
  香: [8, 12],
  味: [14, 22],
  触: [12, 18],
  意: [6, 10],
});

const WANT_LINES = Object.freeze({
  见: '想看看他',
  听: '想听他说说话',
  香: '想闻点好闻的',
  味: '想吃点东西',
  触: '想被抱一下',
  意: '想跟人说说话',
});

const WANT_PATTERNS = Object.freeze({
  见: /照片|图片|自拍|视频|见面|见到|看看|好看/,
  听: /语音|听听|唱歌|录音|音乐|声音|听歌|听你|听我/,
  香: /香水|花香|好香|闻起来|味道/,
  味: /吃(?!惊|亏|醋|力)|饭|外卖|奶茶|烧烤|火锅|零食|饿|好吃|甜|夜宵|面条|拉面|泡面|拌面|碗面/,
  触: /抱抱|抱一下|贴贴|亲亲|摸摸|揉揉|牵手|蹭|靠着/,
  意: /为什么|你觉得|认真|谢谢你|听我说|懂我|陪我说/,
});

function baseWants() {
  const out = {};
  for (const name of WANTS) out[name] = WANT_BASE[name];
  return out;
}

function wantsOf(state) {
  const out = baseWants();
  const src = state && typeof state === 'object' && state.wants && typeof state.wants === 'object'
    ? state.wants
    : null;
  if (!src) return out;
  for (const name of WANTS) {
    if (src[name] == null) continue;
    out[name] = Math.round(clamp(Number(src[name]) || 0, 0, WANT_MAX));
  }
  return out;
}

function decayWants(wants, dtMs, rng = Math.random) {
  const hours = Math.max(0, Number(dtMs) || 0) / 3600000;
  const out = {};
  for (const name of WANTS) {
    const rate = rand(rng, WANT_DECAY_RANGE[name][0], WANT_DECAY_RANGE[name][1]);
    out[name] = Math.round(clamp((Number(wants[name]) || 0) - rate * hours, 0, WANT_MAX));
  }
  return out;
}

function feedWants(text, rng = Math.random) {
  const s = String(text || '');
  const out = {};
  for (const name of WANTS) out[name] = 0;
  if (!s) return out;
  for (const name of WANTS) {
    if (!WANT_PATTERNS[name].test(s)) continue;
    out[name] += rand(rng, WANT_FEED_RANGE[name][0], WANT_FEED_RANGE[name][1]);
  }
  if (s.length > 25) out.意 += rand(rng, 4, 8);
  return out;
}

function hungerOf(state, threshold = 30) {
  const w = wantsOf(state);
  return WANTS
    .map((name) => ({ name, value: w[name] }))
    .filter((item) => item.value <= threshold)
    .sort((a, b) => a.value - b.value);
}

function neediest(state, threshold = 30) {
  const list = hungerOf(state, threshold);
  if (!list.length) return { needy: false, want: null, value: null, line: '' };
  const top = list[0];
  return { needy: true, want: top.name, value: top.value, line: WANT_LINES[top.name] };
}

/* ------------------------------------------------------------------ 学习 */

function dayKey(now = Date.now()) {
  const d = new Date(Number(now) || Date.now());
  const pad = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}

function learnOf(state, now = Date.now()) {
  const day = dayKey(now);
  const src = state && typeof state === 'object' && state.learn && typeof state.learn === 'object' ? state.learn : null;
  const same = src && src.day === day;
  return {
    day,
    auto: same ? Math.max(0, Math.round(Number(src.auto) || 0)) : 0,
    owner: same ? Math.max(0, Math.round(Number(src.owner) || 0)) : 0,
  };
}

/**
 * 记一次学习：先看当天次数有没有到上限，没到才按区间涨「意」。
 * source: 'auto'（自主上网/刷抖音）| 'owner'（主人分享）
 * 返回 { ok, source, count, cap, gain, capped, want }
 */
function bumpLearn(dir, source, { now = Date.now(), rng = Math.random } = {}) {
  const key = source === 'owner' ? 'owner' : 'auto';
  const prev = load(dir);
  const base = decay(prev, now, rng);
  const learn = learnOf(prev, now);
  const cap = LEARN_CAP[key];
  if (learn[key] >= cap) {
    save(dir, { ...prev, ...base, learn, updated: now, version: VERSION });
    return { ok: false, capped: true, source: key, count: learn[key], cap, gain: 0, want: base.wants['意'] || 0 };
  }
  learn[key] += 1;
  const gain = Math.round(rand(rng, LEARN_GAIN[key][0], LEARN_GAIN[key][1]));
  const wants = { ...base.wants };
  wants['意'] = Math.round(clamp((wants['意'] || 0) + gain, 0, WANT_MAX));
  const next = { ...prev, ...base, wants, learn, updated: now, version: VERSION };
  save(dir, next);
  return { ok: true, capped: false, source: key, count: learn[key], cap, gain, want: wants['意'] };
}

/* ------------------------------------------------------------ 耦合 / 反刍 */

const COUPLING = Object.freeze({
  lowAvg: 40,
  highAvg: 75,
  starvingBelow: 30,
  starvingCount: 3,
  sadLow: [0.010, 0.014],
  joyLow: [-0.010, -0.006],
  joyHigh: [0.006, 0.010],
  sadStarving: [0.008, 0.012],
  cap: 0.03,
});

/**
 * 六欲 → 七情。单次联动一律封顶 ±0.03：
 * 饿了会低落，但绝不会因为一条消息把整个人带崩。
 */
function coupling(wants, rng = Math.random) {
  const out = emptyEmotions();
  if (!wants || typeof wants !== 'object') return out;
  const values = WANTS.map((name) => Number(wants[name]) || 0);
  const avg = values.reduce((a, b) => a + b, 0) / (values.length || 1);
  const starving = values.filter((v) => v < COUPLING.starvingBelow).length;
  if (avg < COUPLING.lowAvg) {
    out.哀 += rand(rng, COUPLING.sadLow[0], COUPLING.sadLow[1]);
    out.喜 += rand(rng, COUPLING.joyLow[0], COUPLING.joyLow[1]);
  }
  if (avg > COUPLING.highAvg) {
    out.喜 += rand(rng, COUPLING.joyHigh[0], COUPLING.joyHigh[1]);
  }
  if (starving >= COUPLING.starvingCount) {
    out.哀 += rand(rng, COUPLING.sadStarving[0], COUPLING.sadStarving[1]);
  }
  for (const name of EMOTIONS) out[name] = clamp(out[name], -COUPLING.cap, COUPLING.cap);
  return out;
}

/* ------------------------------------------------------------------ 状态 */

function baseline(now = Date.now()) {
  const scales = {};
  const lastSpike = {};
  for (const name of EMOTIONS) {
    scales[name] = 1;
    lastSpike[name] = 0;
  }
  return {
    ...BASELINE,
    emotions: emptyEmotions(),
    wants: baseWants(),
    scales,
    lastSpike,
    version: VERSION,
    updated: now,
  };
}

function decay(state, now = Date.now(), rng = Math.random) {
  const prev = state && typeof state === 'object' ? state : baseline(now);
  // 注意：updated=0 是合法时间戳（epoch），不能用 || 兜底，否则衰减恒为 0
  const raw = Number(prev.updated);
  const at = Number.isFinite(raw) ? raw : now;
  const dt = Math.max(0, now - at);
  const scale = rand(rng, DECAY_JITTER[0], DECAY_JITTER[1]);
  const k = Math.pow(0.5, dt / (HALF_LIFE_MS * scale));
  return {
    valence: round(BASELINE.valence + ((Number(prev.valence) || BASELINE.valence) - BASELINE.valence) * k),
    arousal: round(BASELINE.arousal + ((Number(prev.arousal) || BASELINE.arousal) - BASELINE.arousal) * k),
    energy: round(BASELINE.energy + ((Number(prev.energy) || BASELINE.energy) - BASELINE.energy) * k),
    emotions: decayEmotions(emotionsOf(prev), dt, { rng, scales: scalesOf(prev) }),
    wants: decayWants(wantsOf(prev), dt, rng),
    version: VERSION,
  };
}

function signals(text, rng = Math.random) {
  const s = String(text || '');
  const out = { valence: 0, arousal: 0, energy: 0, emotions: emptyEmotions() };
  if (!s) return out;
  if (PRAISE.test(s)) {
    out.valence += rand(rng, ...AXIS_RANGE.praise.valence);
    out.arousal += rand(rng, ...AXIS_RANGE.praise.arousal);
    out.energy += rand(rng, ...AXIS_RANGE.praise.energy);
    out.emotions.喜 += rand(rng, EMOTION_RANGE.喜[0], EMOTION_RANGE.喜[1]);
  }
  if (INSULT.test(s)) {
    out.valence += rand(rng, ...AXIS_RANGE.insult.valence);
    out.arousal += rand(rng, ...AXIS_RANGE.insult.arousal);
    out.energy += rand(rng, ...AXIS_RANGE.insult.energy);
    out.emotions.怒 += rand(rng, EMOTION_RANGE.怒[0], EMOTION_RANGE.怒[1]);
    out.emotions.恶 += rand(rng, EMOTION_RANGE.恶[0], EMOTION_RANGE.恶[1]);
  }
  if (AFFECTION.test(s)) {
    out.valence += rand(rng, ...AXIS_RANGE.affection.valence);
    out.arousal += rand(rng, ...AXIS_RANGE.affection.arousal);
    out.emotions.爱 += rand(rng, EMOTION_RANGE.爱[0], EMOTION_RANGE.爱[1]);
    out.emotions.欲 += rand(rng, EMOTION_RANGE.欲[0], EMOTION_RANGE.欲[1]);
  }
  if (COLD.test(s) && s.length <= 6) {
    out.valence += rand(rng, ...AXIS_RANGE.cold.valence);
    out.arousal += rand(rng, ...AXIS_RANGE.cold.arousal);
    out.emotions.哀 += rand(rng, EMOTION_RANGE.哀[0], EMOTION_RANGE.哀[1]);
  }
  if (PRESSURE.test(s)) {
    out.valence += rand(rng, ...AXIS_RANGE.pressure.valence);
    out.arousal += rand(rng, ...AXIS_RANGE.pressure.arousal);
    out.emotions.怒 += rand(rng, PRESSURE_ANGER_RANGE[0], PRESSURE_ANGER_RANGE[1]);
    out.emotions.惧 += rand(rng, EMOTION_RANGE.惧[0], EMOTION_RANGE.惧[1]);
  }
  // 长句通常意味着认真聊，稍微提神
  if (s.length > 60) {
    out.arousal += rand(rng, ...AXIS_RANGE.longText.arousal);
    out.energy += rand(rng, ...AXIS_RANGE.longText.energy);
  }
  return out;
}

function update(state, text, now = Date.now(), rng = Math.random) {
  const base = decay(state, now, rng);
  const d = signals(text, rng);
  const fed = feedWants(text, rng);

  const wants = {};
  for (const name of WANTS) {
    wants[name] = Math.round(clamp((base.wants[name] || 0) + (fed[name] || 0), 0, WANT_MAX));
  }

  const couple = coupling(wants, rng);

  // 反刍：本句点亮了哪条情绪，就给它一段新的"余波尺度"；短窗口内再来一次就加重
  const prevSpike = state && state.lastSpike && typeof state.lastSpike === 'object' ? state.lastSpike : {};
  const scales = scalesOf(state);
  const lastSpike = { ...prevSpike };
  for (const name of EMOTIONS) {
    if (!((d.emotions[name] || 0) > 0)) continue;
    const gap = now - (Number(prevSpike[name]) || 0);
    if (Number(prevSpike[name]) > 0 && gap >= 0 && gap <= RUMINATION_WINDOW_MS) {
      scales[name] = round(clamp(scales[name] * rand(rng, RUMINATION_RANGE[0], RUMINATION_RANGE[1]), 1, RUMINATION_MAX));
    } else {
      scales[name] = round(rand(rng, SCALE_RANGE[0], SCALE_RANGE[1]));
    }
    lastSpike[name] = now;
  }

  const merged = {};
  for (const name of EMOTIONS) {
    merged[name] = round(clamp((base.emotions[name] || 0) + (d.emotions[name] || 0) + (couple[name] || 0), 0, 1));
  }

  return {
    valence: round(clamp(base.valence + d.valence, -1, 1)),
    arousal: round(clamp(base.arousal + d.arousal, 0, 1)),
    energy: round(clamp(base.energy + d.energy, 0, 1)),
    emotions: merged,
    wants,
    scales,
    lastSpike,
    version: VERSION,
    updated: now,
  };
}

/**
 * 直接给情绪/欲望加一笔。
 *
 * 给「不由对话触发」的事件用（自主上网看到东西、以后的世界事件）：先按当前时间
 * 衰减，再叠加，再落盘。返回新状态，方便调用方记日志。
 */
function nudge(dir, { emotions = {}, wants = {}, now = Date.now(), rng = Math.random } = {}) {
  const prev = load(dir);
  const base = decay(prev, now, rng);
  const next = { ...prev, ...base, updated: now, version: VERSION };
  next.emotions = { ...base.emotions };
  for (const name of EMOTIONS) {
    if (!emotions[name]) continue;
    next.emotions[name] = round(clamp((next.emotions[name] || 0) + Number(emotions[name]), 0, 1));
  }
  next.wants = { ...base.wants };
  for (const name of WANTS) {
    if (!wants[name]) continue;
    next.wants[name] = Math.round(clamp((next.wants[name] || 0) + Number(wants[name]), 0, WANT_MAX));
  }
  next.scales = scalesOf(prev);
  next.lastSpike = prev.lastSpike && typeof prev.lastSpike === 'object' ? prev.lastSpike : {};
  save(dir, next);
  return next;
}

/** 人话标签（给提示词用，不给数值） */
function label(state) {
  const s = state || BASELINE;
  const v = Number(s.valence) || 0;
  const a = Number(s.arousal) || 0;
  const e = Number(s.energy) || 0;
  if (e < 0.3) return '有点累，话少一点';
  if (v >= 0.45 && a >= 0.55) return '心情很好，有点雀跃';
  if (v >= 0.35) return '心情不错';
  if (v <= -0.45 && a >= 0.5) return '有点生气，不想多说';
  if (v <= -0.35) return '情绪有点低落';
  if (v <= -0.15) return '有点闷闷的';
  if (a >= 0.6) return '精神比较足，愿意聊';
  if (a <= 0.2) return '懒洋洋的，提不起劲';
  return '平静';
}

const BEHAVIOR_LINES = Object.freeze({
  喜: '话会比平时多一点', 怒: '说话更短更冲', 哀: '话少一点',
  惧: '有点不安，容易多想', 爱: '想多黏一会儿', 恶: '不太想搭话', 欲: '想被人陪一下',
});

function behaviorOf(state) {
  const top = topEmotions(state, 1)[0];
  return top ? (BEHAVIOR_LINES[top.name] || '') : '';
}

function line(state) {
  const mood = label(state);
  const feeling = emotionLabel(state);
  const beh = behaviorOf(state);
  const tail = feeling ? `；这会儿${feeling}${beh ? '，' + beh : ''}` : '';
  return `【此刻心情】${mood}${tail}（自然流露就好，不要报心情数值，也不要解释这条）`;
}

/* ------------------------------------------------------------------ 落盘 */

function fileOf(dir) {
  return path.join(dir, 'mood.json');
}

function load(dir) {
  try {
    const raw = fs.readFileSync(fileOf(dir), 'utf8');
    const d = JSON.parse(raw);
    // v1/v2/v3 文件：补齐七情、六欲、尺度与版本再交出去，调用方不必自己判空
    if (d && typeof d === 'object') {
      return { ...d, emotions: emotionsOf(d), wants: wantsOf(d), scales: scalesOf(d), version: VERSION };
    }
  } catch (err) {
    if (err && err.code !== 'ENOENT') {
      // 文件坏了不要影响聊天：回到基线
    }
  }
  return baseline();
}

function save(dir, state) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    const file = fileOf(dir);
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(state), 'utf8');
    fs.renameSync(tmp, file);
  } catch (err) {
    // 写失败只影响"记忆惯性"，不能影响这一轮回复
  }
}

/** 一轮的完整入口：读 → 衰减 → 叠加 → 存 → 返回提示词行 */
function tick({ dir, text = '', now = Date.now(), rng = Math.random }) {
  const prev = load(dir);
  const next = update(prev, text, now, rng);
  save(dir, next);
  return { state: next, line: line(next) };
}

/** 只读预览：算出来但不落盘（调试台预览提示词时用，不能因为看一眼就改心情） */
function peek({ dir, text = '', now = Date.now(), rng = Math.random }) {
  const next = update(load(dir), text, now, rng);
  return { state: next, line: line(next) };
}

module.exports = {
  BASELINE,
  HALF_LIFE_MS,
  VERSION,
  EMOTIONS,
  EMOTION_HALF_LIFE_MS,
  EMOTION_RANGE,
  SCALE_RANGE,
  RUMINATION_WINDOW_MS,
  RUMINATION_RANGE,
  RUMINATION_MAX,
  WANTS,
  WANT_MAX,
  PRESSURE_ANGER_RANGE,
  LEARN_CAP,
  LEARN_GAIN,
  learnOf,
  bumpLearn,
  dayKey,
  WANT_BASE,
  WANT_DECAY_RANGE,
  WANT_FEED_RANGE,
  WANT_LINES,
  COUPLING,
  AXIS_RANGE,
  baseline,
  decay,
  decayEmotions,
  emotionsOf,
  scalesOf,
  topEmotions,
  emotionLabel,
  signals,
  update,
  label,
  line,
  baseWants,
  wantsOf,
  decayWants,
  feedWants,
  hungerOf,
  neediest,
  nudge,
  coupling,
  load,
  save,
  peek,
  tick,
};
