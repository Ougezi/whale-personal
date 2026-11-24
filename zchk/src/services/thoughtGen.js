'use strict';

/**
 * 念头生成（P5a）：偶尔用模型写一条「她心里挂着的事」。
 *
 * 为什么不在回复链路上同步生成：那会给每一轮加一两秒延迟。这里改成
 * **发完/构建完之后异步跑一次**（chat.js 不 await），生成的结果写进
 * data/thoughts.json，从**下一轮**开始生效。
 *
 * 节流（config.thoughts.modelIntervalMin / modelPerDay，默认 30 分钟 / 24 条）：
 * - 先占坑（noteModelCall）再请求，避免并发时多打几次；
 * - 每天 0 条也能关（perDay=0 = 完全关闭模型生成，只用本地模板）。
 *
 * 失败一律吞掉：念头生成永远不许影响聊天本身。
 */

const thoughts = require('../core/thoughts');
const mood = require('../core/mood');
const { describeError } = require('../infra/errors');

const SYSTEM = [
  '你是鲸鲸的内心旁白。根据她的心情、她缺的东西、刚聊过的几句，写一条她自己心里挂着的短念头。',
  '要求：第一人称；8~20 个字；不要复述对方原话；不要提问；不要解释；不要加引号；只输出这一句。',
].join('\n');

function cleanThought(raw) {
  const first = String(raw == null ? '' : raw)
    .split(/\r?\n/)
    .map((x) => x.trim())
    .filter(Boolean)[0] || '';
  return first
    .replace(/^["'“”‘’「」『』]+|["'“”‘’「」『』]+$/g, '')
    .replace(/[~～]+\s*$/g, '')
    .trim()
    .slice(0, 24);
}

function limits(config) {
  const c = (config && config.thoughts) || {};
  const intervalMin = Number(c.modelIntervalMin);
  const perDay = Number(c.modelPerDay);
  return {
    intervalMin: Number.isFinite(intervalMin) && intervalMin >= 1 ? intervalMin : thoughts.MODEL_INTERVAL_MIN,
    perDay: Number.isFinite(perDay) && perDay >= 0 ? perDay : thoughts.MODEL_PER_DAY,
  };
}

/**
 * 需要时异步补一条模型念头。**调用方不要 await**（它就是故意不等）。
 * 返回 Promise<string|null>，只为测试方便。
 */
async function maybe(runtime, { dir, state = null, now = Date.now(), recent = [] } = {}) {
  if (!runtime || !runtime.llm || !dir) return null;
  // 演示模式（没 Key）不写模型念头：mock 回复会变成一堆假「心里话」
  if (runtime.llm.isMock) return null;
  const { intervalMin, perDay } = limits(runtime.config);
  if (perDay <= 0) return null;
  if (!thoughts.modelAllowed(dir, { intervalMin, perDay, now })) return null;
  thoughts.noteModelCall(dir, now);
  try {
    const st = state || mood.load(dir);
    const need = mood.neediest(st, 35);
    const emotions = mood.topEmotions(st, 2).map((x) => x.name + Math.round(x.value * 100) + '%').join(' ') || '平静';
    const lines = [
      '最近聊的：',
      recent.length ? recent.slice(-4).join('\n') : '（刚才没聊什么）',
      '',
      `她此刻最明显的情绪：${emotions}`,
      need.needy ? `她这会儿最缺：${need.want}（${need.line}）` : '她没有特别缺什么',
    ];
    const raw = await runtime.llm.complete({ system: SYSTEM, turns: [{ role: 'user', content: lines.join('\n') }] });
    const text = cleanThought(raw);
    if (!text) return null;
    thoughts.add(dir, text, now);
    return text;
  } catch (err) {
    runtime.logger?.debug?.('念头生成失败：' + describeError(err));
    return null;
  }
}

module.exports = { maybe, cleanThought, limits, SYSTEM };
