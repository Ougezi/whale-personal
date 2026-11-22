'use strict';

/**
 * 自主上网（P5b）：她隔几小时自己刷一条热榜，用一句自己的话反应一下，再影响心情。
 *
 * 参考抖音「大肥鱼」公开的做法（RSS 随机挑一条没看过的 → 用自己的话说一句 →
 * 写回情绪和欲望；3 小时冷却、每天 5 次、单次约 0.0005 元）。这里用现成的热榜
 * 适配器（微博 / B站 / 头条）代替 RSS，省掉一整套抓取和解析。
 *
 * 边界：
 *  - 默认 180 分钟一次、每天最多 5 次，可在 config.browse.* 调；
 *  - 只读热榜标题，不下载页面正文、不点广告；
 *  - 两次不看同一条（seen 里记 key，最多留 200 条）；
 *  - 任何失败都只记日志，不抛给调度器，也不影响聊天。
 */

const fs = require('node:fs');
const path = require('node:path');
const thoughts = require('../core/thoughts');
const mood = require('../core/mood');
const { hotlistResult } = require('../adapters/search/hotlists');
const features = require('../infra/features');
const { describeError } = require('../infra/errors');

const VERSION = 1;
const DEFAULT_SOURCES = ['weibo', 'bilibili', 'toutiao'];
/** 主人在私聊里能让她「现在去看看」的说法（口令，不喂模型） */
const ASK_RE = /^(?:去看看|去看看吧|上网看看|自己看看|自己去看看|看看热榜|刷一下热榜|随便看看|去看看呗)[。！!～~吧]*$/;

function isBrowseAsk(text) {
  return ASK_RE.test(String(text || '').replace(/\s+/g, ''));
}

/** 口令的回复文案（纯函数，方便测试） */
function formatReply(out) {
  if (!out || !out.ok) {
    if (out && out.reason === 'daily_cap') return { ok: false, text: '今天看得够多了，明天再刷。' };
    if (out && out.reason === 'disabled') return { ok: false, text: '自主上网关着呢，想开就在启动器里打开。' };
    return { ok: false, text: '这会儿没看成，等会儿再试。' };
  }
  const title = String(out.title || '').slice(0, 40);
  const reaction = String(out.reaction || '').trim();
  return { ok: true, text: reaction ? `刚刷到「${title}」，${reaction}` : `刚刷到一条：「${title}」` };
}

const SYSTEM = [
  '你刚在网上刷到一条东西，现在用你自己的口气说一句反应。',
  '要求：8~20 个中文字；第一人称；不要复述标题；不要说"看到一条新闻"这种话；不要提问；只输出这一句。',
].join('\n');

function stateFile(dir) {
  return path.join(dir, 'browse-state.json');
}

function dayKey(now = Date.now()) {
  const d = new Date(now);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function loadState(dir) {
  try {
    const d = JSON.parse(fs.readFileSync(stateFile(dir), 'utf8'));
    return {
      version: VERSION,
      day: String(d && d.day || ''),
      count: Number(d && d.count) || 0,
      lastTs: Number(d && d.lastTs) || 0,
      seen: Array.isArray(d && d.seen) ? d.seen.slice(-200) : [],
    };
  } catch (err) {
    return { version: VERSION, day: '', count: 0, lastTs: 0, seen: [] };
  }
}

function saveState(dir, state) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    const file = stateFile(dir);
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify({ ...state, seen: (state.seen || []).slice(-200) }), 'utf8');
    fs.renameSync(tmp, file);
  } catch (err) {
    // 状态写不进去只影响下一次的判断，不影响这次已经做完的事
  }
}

function randInt(rng, lo, hi) {
  const r = typeof rng === 'function' ? rng() : Math.random();
  const x = Number.isFinite(r) ? Math.min(0.9999, Math.max(0, r)) : 0.5;
  return Math.round(lo + (hi - lo) * x);
}

function cleanReaction(raw) {
  const first = String(raw == null ? '' : raw)
    .split(/\r?\n/)
    .map((x) => x.trim())
    .filter(Boolean)[0] || '';
  return first.replace(/^["'“”‘’「」『』]+|["'“”‘’「」『』]+$/g, '').replace(/[~～]+\s*$/g, '').trim().slice(0, 40);
}

/**
 * 看到一条东西之后，她应该被影响成什么样。
 *
 * **不能一律加喜/加欲**：第一版就是那么写的，结果刷到「山东一地推行一日丧」她
 * 说「这事我真没法接受」之后，情绪却涨了喜 —— 心情和话对不上。所以这里改成：
 *   - 用 mood.signals(她说的那句话) 读出真实情绪（骂、难过、亲昵……）
 *   - 用 mood.feedWants 读出这句话喂到了哪样欲望
 *   - 好奇被满足是固定的：自主上网 意 +33~37（中点 35），主人分享 意 +13~17（中点 15）
 * 纯函数，方便测试。
 */
function writeBackFor(reaction, { rng = Math.random, source = 'auto' } = {}) {
  const emotions = {};
  const wants = {};
  try {
    const sig = mood.signals(String(reaction || ''));
    for (const name of mood.EMOTIONS) {
      const value = Number(sig && sig.emotions && sig.emotions[name]);
      if (Number.isFinite(value) && value > 0) emotions[name] = Math.round(value * 1000) / 1000;
    }
  } catch (err) {
    // 读不出情绪就不加情绪，只留下面的好奇
  }
  try {
    const fed = mood.feedWants(String(reaction || ''));
    for (const name of mood.WANTS) {
      if (name === '意') continue;
      const value = Number(fed && fed[name]);
      if (Number.isFinite(value) && value > 0) wants[name] = Math.round(value);
    }
  } catch (err) {
    // 同上
  }
  // 好奇被满足：自己刷 33~37（中点 35），主人分享 13~17（中点 15）
  wants.意 = source === 'owner' ? randInt(rng, 13, 17) : randInt(rng, 33, 37);
  return { emotions, wants };
}

function browseSettings(config) {
  const c = (config && config.browse) || {};
  const interval = Number(c.intervalMin);
  const maxPerDay = Number(c.maxPerDay);
  const sources = Array.isArray(c.sources) && c.sources.length
    ? c.sources.filter((s) => DEFAULT_SOURCES.includes(s))
    : DEFAULT_SOURCES;
  return {
    intervalMin: Number.isFinite(interval) && interval >= 10 ? interval : 180,
    maxPerDay: Number.isFinite(maxPerDay) && maxPerDay >= 0 ? maxPerDay : 5,
    sources: sources.length ? sources : DEFAULT_SOURCES,
  };
}

class BrowseService {
  constructor(runtime) {
    this.runtime = runtime;
    this.logger = runtime && runtime.logger ? runtime.logger : null;
  }

  /** 配置热重载会替换 runtime.config 这个对象，所以每次用都要现取，不能缓存引用 */
  get config() {
    return (this.runtime && this.runtime.config) || {};
  }

  dataDir() {
    return (this.config.paths && this.config.paths.dataDir) || path.join(process.cwd(), 'data');
  }

  /** 挂到进程内调度器上：每 intervalMin 分钟问一次「该不该看」，真正判断在 tick 里 */
  start() {
    if (!this.runtime || !this.runtime.scheduler || typeof this.runtime.scheduler.every !== 'function') return false;
    const { intervalMin } = browseSettings(this.config);
    this.runtime.scheduler.every('browse.once', intervalMin * 60 * 1000, () => {
      this.tick().catch((err) => this.logger?.warn?.('自主上网失败：' + describeError(err)));
    });
    return true;
  }

  /**
   * 看一条并写回情绪/欲望/念头。可手动调用（force=true 跳过冷却，用于验证）。
   * 返回结构化的结果，方便接口和日志照抄。
   */
  async tick({ now = Date.now(), force = false, rng = Math.random } = {}) {
    const dir = this.dataDir();
    const { intervalMin, maxPerDay, sources } = browseSettings(this.config);
    if (!force && !features.isOn(this.config, 'browse')) return { ok: false, reason: 'disabled' };

    const state = loadState(dir);
    const countToday = state.day === dayKey(now) ? state.count : 0;
    if (!force) {
      if (maxPerDay <= 0) return { ok: false, reason: 'disabled' };
      if (countToday >= maxPerDay) return { ok: false, reason: 'daily_cap', countToday, maxPerDay };
      if (state.lastTs && now - state.lastTs < intervalMin * 60000) {
        return { ok: false, reason: 'too_soon', waitMinutes: Math.ceil((intervalMin * 60000 - (now - state.lastTs)) / 60000) };
      }
    }

    const source = sources[Math.floor(((typeof rng === 'function' ? rng() : Math.random()) * sources.length)) % sources.length];
    let items = [];
    try {
      const res = await hotlistResult(source, { limit: 12 });
      items = Array.isArray(res && res.items) ? res.items : Array.isArray(res) ? res : [];
    } catch (err) {
      this.logger?.warn?.(`自主上网：${source} 热榜取不到（${describeError(err)}）`);
      return { ok: false, reason: 'source_failed', source };
    }
    const seen = new Set(state.seen || []);
    const fresh = items.filter((it) => it && it.title && !seen.has(`${source}|${it.title}`));
    if (!fresh.length) return { ok: false, reason: 'nothing_new', source, scanned: items.length };

    const pick = fresh[Math.min(fresh.length - 1, Math.floor(((typeof rng === 'function' ? rng() : Math.random()) * fresh.length)))];
    let reaction = '';
    if (this.runtime && this.runtime.llm && typeof this.runtime.llm.complete === 'function') {
      try {
        const raw = await this.runtime.llm.complete({
          system: SYSTEM,
          turns: [{ role: 'user', content: `这条：${String(pick.title).slice(0, 80)}（来源：${source}）。只回一句，别解释。` }],
          maxTokens: 120,
        });
        reaction = cleanReaction(raw);
      } catch (err) {
        this.logger?.debug?.('自主上网：生成反应失败（' + describeError(err) + '）');
      }
    }
    if (!reaction) reaction = '看了会儿，说不上来什么感觉';

    // 写回：情绪来自她自己那句话（不再一律加喜），只有"好奇被满足"固定给意
    const applied = writeBackFor(reaction, { rng });
    try {
      mood.nudge(dir, { emotions: applied.emotions, wants: applied.wants, now, rng });
    } catch (err) {
      this.logger?.warn?.('自主上网：写回情绪失败（' + describeError(err) + '）');
    }
    try {
      thoughts.add(dir, reaction, now);
    } catch (err) {
      // 念头写不进去不影响这次浏览
    }

    saveState(dir, {
      version: VERSION,
      day: dayKey(now),
      count: countToday + 1,
      lastTs: now,
      seen: [...state.seen, `${source}|${pick.title}`],
    });

    return {
      ok: true,
      source,
      title: String(pick.title).slice(0, 120),
      url: pick.url || null,
      reaction,
      applied,
      countToday: countToday + 1,
      maxPerDay,
      intervalMin,
    };
  }
}

module.exports = { BrowseService, browseSettings, loadState, saveState, writeBackFor, cleanReaction, isBrowseAsk, formatReply, ASK_RE, DEFAULT_SOURCES, SYSTEM, dayKey };
