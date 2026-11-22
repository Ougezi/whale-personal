#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
鲸鲸 · 个人版：把「情绪 / 念头 / 自主上网」这一层接进官方 4.1.8 源码。

新文件已经放好（src/core/mood.js、thoughts.js、services/thoughtGen.js、browse.js、
http/routes/browse.js），这个脚本只做接线：
  care.js        六欲闸门（careDesire / careDue / buildCarePrompt / exports）
  chat.js        情绪 + 念头注入、口令「去看看」
  debug.js       诊断页只读预览（mood.peek / thoughts.peek）
  features.js    注册 mood / thoughts / browse 三个开关
  configSchema.js 注册 care.followDesire / needThreshold、thoughts.*、browse.*
  config.js      写进 DEFAULT_CONFIG
  app.js         启动 BrowseService 并挂到 bot
  http/routes/index.js  挂上 /api/browse 与 /browse 页面

用法（在 D:\\dsh\\whale-personal 下，用鲸鲸自带 python）：
    python apply_personal_layer.py --check
    python apply_personal_layer.py
"""
import os
import shutil
import subprocess
import sys
import time

FORK = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'src')
NODE = os.path.join(os.environ.get('LOCALAPPDATA', ''), 'Programs', 'WhaleGirl', 'runtime', 'node.exe')

CARE = os.path.join(FORK, 'src', 'services', 'care.js')
CHAT = os.path.join(FORK, 'src', 'pipeline', 'chat.js')
DEBUG = os.path.join(FORK, 'src', 'services', 'debug.js')
FEATURES = os.path.join(FORK, 'src', 'infra', 'features.js')
SCHEMA = os.path.join(FORK, 'src', 'infra', 'configSchema.js')
CONFIG = os.path.join(FORK, 'src', 'infra', 'config.js')
APP = os.path.join(FORK, 'src', 'app.js')
ROUTES = os.path.join(FORK, 'src', 'http', 'routes', 'index.js')

# ------------------------------------------------------------------ care.js
CARE_REQ_OLD = "const { toBool } = require('../infra/features');"
CARE_REQ_NEW = """const { toBool } = require('../infra/features');
const mood = require('../core/mood');
const fs = require('node:fs');
const path = require('node:path');"""

CARE_NORM_OLD = """  return {
    enabled: toBool(c.enabled, true),
    windows: parseWindows(c.windows),
    everyMinutes: Number.isFinite(every) && every > 0 ? every : 90,
    jitterMinutes: Number.isFinite(jitter) && jitter >= 0 ? jitter : 25,
    maxPerDay: Number.isFinite(maxPerDay) && maxPerDay >= 0 ? maxPerDay : 6,
    quietAfterMinutes: Number.isFinite(quiet) && quiet >= 0 ? quiet : 20,
  };"""

CARE_NORM_NEW = """  const followDesire = c.followDesire == null ? true : toBool(c.followDesire, true);
  const needThreshold = Number.isFinite(Number(c.needThreshold)) ? Number(c.needThreshold) : 30;
  return {
    enabled: toBool(c.enabled, true),
    windows: parseWindows(c.windows),
    everyMinutes: Number.isFinite(every) && every > 0 ? every : 90,
    jitterMinutes: Number.isFinite(jitter) && jitter >= 0 ? jitter : 25,
    maxPerDay: Number.isFinite(maxPerDay) && maxPerDay >= 0 ? maxPerDay : 6,
    quietAfterMinutes: Number.isFinite(quiet) && quiet >= 0 ? quiet : 20,
    followDesire,
    needThreshold: Math.min(100, Math.max(0, needThreshold)),
  };"""

CARE_DESIRE_BLOCK = """
/**
 * 现在缺不缺、最缺哪一样（六个欲望里最低的那个）。
 * 读 data/mood.json，先按当前时间衰减（不写盘）；读不到就放行，绝不让她突然沉默。
 */
function careDesire(config, { care = null, threshold = null } = {}) {
  const cfgCare = care || normalizeCare(config);
  const limit = Number.isFinite(threshold) ? Number(threshold) : cfgCare.needThreshold;
  const dir = config && config.paths && config.paths.dataDir ? config.paths.dataDir : '';
  if (!dir) return { enabled: false, reason: 'no_data_dir', needy: false, want: null, value: null, threshold: limit };
  try {
    if (!fs.existsSync(path.join(dir, 'mood.json'))) {
      return { enabled: false, reason: 'no_mood_file', needy: false, want: null, value: null, threshold: limit };
    }
    const state = mood.decay(mood.load(dir), Date.now());
    const need = mood.neediest(state, limit);
    return { enabled: true, threshold: limit, ...need };
  } catch (err) {
    return { enabled: false, reason: 'mood_unreadable', needy: false, want: null, value: null, threshold: limit };
  }
}

"""

CARE_OK_OLD = """  return {
    due: true,
    reason: 'ok',
    gapMinutes,
    now: formatMinutes(minutesOfDay),
    sentToday: Number(sentToday),
    maxPerDay: care.maxPerDay,
    waitMinutes: null,
  };"""

CARE_OK_NEW = """  // 六欲闸门：到点只是前提，还得她真的缺了什么才开口；状态读不出来时不拦
  const desire = careDesire(config, { care });
  const needy = !desire.enabled || desire.needy;
  if (care.followDesire && !needy) {
    return {
      due: false,
      reason: 'not_needy',
      desire,
      gapMinutes,
      now: formatMinutes(minutesOfDay),
      sentToday: Number(sentToday),
      maxPerDay: care.maxPerDay,
      waitMinutes: null,
    };
  }

  return {
    due: true,
    reason: 'ok',
    desire,
    gapMinutes,
    now: formatMinutes(minutesOfDay),
    sentToday: Number(sentToday),
    maxPerDay: care.maxPerDay,
    waitMinutes: null,
  };"""

CARE_PROMPT_SIG_OLD = "function buildCarePrompt({ persona = {}, recent = [], name = '', hour = null } = {}) {"
CARE_PROMPT_SIG_NEW = "function buildCarePrompt({ persona = {}, recent = [], name = '', hour = null, want = null, wantLine = '' } = {}) {"

CARE_PROMPT_HOUR_OLD = """  if (Number.isFinite(hour)) {
    const part = hour < 6 ? '凌晨' : hour < 11 ? '早上' : hour < 14 ? '中午' : hour < 18 ? '下午' : hour < 23 ? '晚上' : '深夜';
    lines.push(`- 现在是${part}，语气跟这个时间搭一点。`);
  }"""

CARE_PROMPT_HOUR_NEW = """  if (Number.isFinite(hour)) {
    const part = hour < 6 ? '凌晨' : hour < 11 ? '早上' : hour < 14 ? '中午' : hour < 18 ? '下午' : hour < 23 ? '晚上' : '深夜';
    lines.push(`- 现在是${part}，语气跟这个时间搭一点。`);
  }
  // 她这次开口是因为真的缺了什么，句子围着那个缺口说
  if (wantLine) {
    lines.push(`- 你这会儿${wantLine}，就顺着这个开口（这是你自己的感觉，不是要求对方做什么）。`);
  }"""

CARE_EXPORT_OLD = "  buildCarePrompt,"
CARE_EXPORT_NEW = "  careDesire,\n  buildCarePrompt,"

# ------------------------------------------------------------------ chat.js
CHAT_REQ_OLD = "const VERSION = require('../../package.json').version;"
CHAT_REQ_NEW = """const VERSION = require('../../package.json').version;
const mood = require('../core/mood');
const thoughts = require('../core/thoughts');
const thoughtGen = require('../services/thoughtGen');
const browseCore = require('../services/browse');"""

CHAT_BLOCK_ANCHOR = "    const promptParts = persona.buildPromptParts({"

CHAT_BLOCK_NEW = """    // 情绪状态（三轴 + 七情 + 六欲）：有惯性；关掉 features.mood 就不读写
    let moodLine = '';
    let moodState = null;
    const innerDir = this.config.paths?.dataDir || path.join(process.cwd(), 'data');
    if (features.isOn(this.config, 'mood')) {
      try {
        const ticked = mood.tick({
          dir: innerDir,
          text: (clean && clean.text) || msg.text || '',
          now: nowMs,
        });
        moodLine = ticked.line;
        moodState = ticked.state;
      } catch (err) {
        moodLine = '';
      }
    }
    // 念头流：跨轮携带、3 小时淡掉；每轮最多带出两条，明说「不一定要说出来」
    let thoughtLine = '';
    if (features.isOn(this.config, 'thoughts')) {
      try {
        thoughtLine = thoughts.line(innerDir, { state: moodState, now: nowMs }).text;
      } catch (err) {
        thoughtLine = '';
      }
    }
    // 模型写的念头：不 await（不拖慢这一轮），节流在 thoughtGen 里；下一轮才看得到
    if (features.isOn(this.config, 'thoughts')) {
      try {
        const heard = String((clean && clean.text) || msg.text || '').slice(0, 60);
        thoughtGen
          .maybe(this, { dir: innerDir, state: moodState, now: nowMs, recent: heard ? ['对方：' + heard] : [] })
          .catch(() => {});
      } catch (err) {
        // 生成念头是锦上添花，失败不许影响回复
      }
    }
    const innerLine = [moodLine, thoughtLine].filter(Boolean).join('\\n');

""" + CHAT_BLOCK_ANCHOR

CHAT_PASS_OLD = """      now,
      envBlock,
    });"""
CHAT_PASS_NEW = """      moodLine: innerLine,
      now,
      envBlock,
    });"""

CHAT_ADMIN_OLD = """    const adminReply = this.handleAdmin({ msg, clean, key, state, isMaster, nowMs });
    if (adminReply) return adminReply;"""
CHAT_ADMIN_NEW = CHAT_ADMIN_OLD + """

    // 主人私聊里说「去看看 / 上网看看」→ 真的去看一条热榜，回她自己那句话
    const browseReply = await this.handleBrowseAsk({ msg, clean, key, isMaster, isGroup, atMe });
    if (browseReply) return browseReply;"""

CHAT_METHOD_ANCHOR = "  handleAdmin({ msg, clean, key, state, isMaster, nowMs }) {"

CHAT_METHOD = """  /**
   * 「去看看 / 上网看看」：一句口令，真的去看一条热榜。
   * 只认主人私聊；结果写回情绪与念头，回复用她自己那句话。
   */
  async handleBrowseAsk({ msg, clean, key, isMaster, isGroup, atMe }) {
    if (!this.browse || typeof this.browse.tick !== 'function') return null;
    if (!isMaster || isGroup) return null;
    const raw = String((clean && clean.text) || '').trim();
    if (!browseCore.isBrowseAsk(raw)) return null;
    const base = { action: 'command', commandType: 'browse', key, msg, atMe: true, reason: 'browse' };
    try {
      const out = await this.browse.tick({ force: true });
      return { ...base, text: browseCore.formatReply(out).text };
    } catch (err) {
      return null;
    }
  }

""" + CHAT_METHOD_ANCHOR

# ------------------------------------------------------------------ debug.js
DEBUG_REQ_OLD = "async function debugPrompt(runtime, body) {"
DEBUG_REQ_NEW = """const mood = require('../core/mood');
const thoughts = require('../core/thoughts');

async function debugPrompt(runtime, body) {"""

DEBUG_BLOCK_ANCHOR = "  const parts = persona.buildPromptParts({"
DEBUG_BLOCK_NEW = """  // 情绪 / 念头只读预览：和真实提示词同一套状态，但看一眼不改变它
  let moodLine = '';
  try {
    if (features.isOn(config, 'mood')) {
      const dir = config.paths?.dataDir || path.join(process.cwd(), 'data');
      moodLine = mood.peek({ dir, text, now: now.getTime() }).line;
    }
  } catch { moodLine = ''; }
  let thoughtLine = '';
  try {
    if (features.isOn(config, 'thoughts')) {
      const dir = config.paths?.dataDir || path.join(process.cwd(), 'data');
      thoughtLine = thoughts.peek(dir, { now: now.getTime() }).text;
    }
  } catch { thoughtLine = ''; }
  const innerLine = [moodLine, thoughtLine].filter(Boolean).join('\\n');

""" + DEBUG_BLOCK_ANCHOR

DEBUG_PASS_OLD = """    notes: [],
    now,
    envBlock: envInfo.systemBlock(config, VERSION),"""
DEBUG_PASS_NEW = """    notes: [],
    moodLine: innerLine,
    now,
    envBlock: envInfo.systemBlock(config, VERSION),"""

# --------------------------------------------------------------- features.js
FEATURES_ANCHOR = "const REGISTRY = ["
FEATURES_NEW = FEATURES_ANCHOR + """
  {
    key: 'mood',
    path: 'features.mood',
    label: '情绪状态（三轴 + 七情 + 六欲）',
    desc: '关掉后不读写 data/mood.json，提示词里没有【此刻心情】这一行；开着时情绪有惯性（各有半衰期）、六个欲望会自己饿。',
    default: true,
  },
  {
    key: 'thoughts',
    path: 'features.thoughts',
    label: '念头流（脑子里挂着的事）',
    desc: '关掉后不读写 data/thoughts.json，提示词里没有【脑子里挂着的】。开着时心里挂 3~5 条短念头，跨轮带着、3 小时淡掉。',
    default: true,
  },
  {
    key: 'browse',
    path: 'features.browse',
    label: '自主上网（隔几小时自己刷一条热榜）',
    desc: '关掉后完全不联网、不写 data/browse-state.json。开着时每 180 分钟挑一条没看过的热榜，用自己的话说一句并影响情绪念头（每天最多 5 次）。',
    default: true,
  },"""

# ------------------------------------------------------------ configSchema.js
SCHEMA_OLD = "  'care.quietAfterMinutes': { type: 'int', min: 0, max: 1440 },"
SCHEMA_NEW = """  'care.quietAfterMinutes': { type: 'int', min: 0, max: 1440 },
  'care.followDesire': { type: 'bool' },
  'care.needThreshold': { type: 'int', min: 0, max: 100 },
  'thoughts.modelIntervalMin': { type: 'int', min: 1, max: 1440 },
  'thoughts.modelPerDay': { type: 'int', min: 0, max: 200 },
  'browse.intervalMin': { type: 'int', min: 10, max: 1440 },
  'browse.maxPerDay': { type: 'int', min: 0, max: 50 },"""

# ------------------------------------------------------------------ config.js
CONFIG_OLD = """    maxPerDay: 6,
    quietAfterMinutes: 20,
  },
"""
CONFIG_NEW = """    maxPerDay: 6,
    quietAfterMinutes: 20,
    followDesire: true,
    needThreshold: 30,
  },
  thoughts: {
    modelIntervalMin: 30,
    modelPerDay: 24,
  },
  browse: {
    intervalMin: 180,
    maxPerDay: 5,
    sources: ['weibo', 'bilibili', 'toutiao'],
  },
"""

# --------------------------------------------------------------------- app.js
APP_OLD = "  runtime.bot.diary = runtime.diary;"
APP_NEW = """  runtime.bot.diary = runtime.diary;
  // 自主上网：隔几小时自己刷一条热榜，用自己的话说一句，再写回情绪与念头
  try {
    const { BrowseService } = require('./services/browse');
    runtime.browse = new BrowseService(runtime);
    runtime.browse.start();
    runtime.bot.browse = runtime.browse;
  } catch (err) {
    logger.warn('自主上网没有启动（不影响聊天）：' + describeError(err));
  }"""

# ------------------------------------------------------------------ routes
ROUTES_OLD = "  require('./care'),"
ROUTES_NEW = "  require('./care'),\n  require('./browse'),"

PLAN = [
    (CARE, CARE_REQ_OLD, CARE_REQ_NEW, 'care.js require'),
    (CARE, CARE_NORM_OLD, CARE_NORM_NEW, 'care.js normalizeCare'),
    (CARE, 'function careDue(config, { lastSentTs = 0, sentToday = 0, now = Date.now() } = {}) {',
     CARE_DESIRE_BLOCK.lstrip('\n') + 'function careDue(config, { lastSentTs = 0, sentToday = 0, now = Date.now() } = {}) {',
     'care.js careDesire'),
    (CARE, CARE_OK_OLD, CARE_OK_NEW, 'care.js 欲望闸门'),
    (CARE, CARE_PROMPT_SIG_OLD, CARE_PROMPT_SIG_NEW, 'care.js buildCarePrompt 签名'),
    (CARE, CARE_PROMPT_HOUR_OLD, CARE_PROMPT_HOUR_NEW, 'care.js 缺口提示'),
    (CARE, CARE_EXPORT_OLD, CARE_EXPORT_NEW, 'care.js exports'),
    (CHAT, CHAT_REQ_OLD, CHAT_REQ_NEW, 'chat.js require'),
    (CHAT, CHAT_BLOCK_ANCHOR, CHAT_BLOCK_NEW, 'chat.js 情绪/念头块'),
    (CHAT, CHAT_PASS_OLD, CHAT_PASS_NEW, 'chat.js 传参'),
    (CHAT, CHAT_ADMIN_OLD, CHAT_ADMIN_NEW, 'chat.js 口令挂载'),
    (CHAT, CHAT_METHOD_ANCHOR, CHAT_METHOD, 'chat.js 新增方法'),
    (DEBUG, DEBUG_REQ_OLD, DEBUG_REQ_NEW, 'debug.js require'),
    (DEBUG, DEBUG_BLOCK_ANCHOR, DEBUG_BLOCK_NEW, 'debug.js 预览块'),
    (DEBUG, DEBUG_PASS_OLD, DEBUG_PASS_NEW, 'debug.js 传参'),
    (FEATURES, FEATURES_ANCHOR, FEATURES_NEW, 'features.js 三个开关'),
    (SCHEMA, SCHEMA_OLD, SCHEMA_NEW, 'configSchema.js 键'),
    (CONFIG, CONFIG_OLD, CONFIG_NEW, 'config.js 默认值'),
    (APP, APP_OLD, APP_NEW, 'app.js 启动 browse'),
    (ROUTES, ROUTES_OLD, ROUTES_NEW, 'routes/index.js'),
]


def main():
    check_only = '--check' in sys.argv
    if not os.path.isfile(CARE):
        print('[失败] 找不到个人版源码：' + FORK)
        return 1
    texts = {}
    for path, _o, _n, _l in PLAN:
        if path not in texts:
            with open(path, 'r', encoding='utf-8', newline='') as f:
                texts[path] = f.read()
    if 'careDesire' in texts[CARE] and 'handleBrowseAsk' in texts[CHAT]:
        print('[跳过] 已经接线过了')
        return 0

    staged = {}
    for path, old, new, label in PLAN:
        text = staged.get(path, texts[path])
        nl = '\r\n' if '\r\n' in text else '\n'
        o, n_ = old.replace('\n', nl), new.replace('\n', nl)
        cnt = text.count(o)
        if cnt != 1:
            print('[失败] %s 锚点数 = %d' % (label, cnt))
            return 1
        staged[path] = text.replace(o, n_, 1)

    if check_only:
        for path in staged:
            print('[可接线] %s：%d → %d 字符' % (os.path.relpath(path, FORK), len(texts[path]), len(staged[path])))
        return 0

    stamp = time.strftime('%Y%m%d-%H%M%S')
    backups = []
    try:
        for path in staged:
            bak = path + '.bak-personal-' + stamp
            shutil.copy2(path, bak)
            backups.append((path, bak))
            tmp = path + '.tmp-personal'
            with open(tmp, 'w', encoding='utf-8', newline='') as f:
                f.write(staged[path])
            os.replace(tmp, path)
        for path in staged:
            check = subprocess.run([NODE, '--check', path], capture_output=True, text=True)
            if check.returncode != 0:
                raise SystemExit('[失败] node --check 没过：%s\n%s' % (path, (check.stderr or '')[:400]))
    except SystemExit as err:
        for path, bak in backups:
            shutil.copy2(bak, path)
        print(err)
        print('[已回滚]')
        return 1

    for path in staged:
        print('[已接线] ' + os.path.relpath(path, FORK))
    print('[备份] ' + ', '.join(os.path.basename(b) for _p, b in backups))
    return 0


if __name__ == '__main__':
    sys.exit(main())
