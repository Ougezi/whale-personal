'use strict';

const care = require('./care');
const hobby = require('./hobby');
const features = require('../infra/features');
const time = require('../infra/time');
const { describeError } = require('../infra/errors');

/**
 * 主动搭话的内容：问她一句「在干啥 / 累不累」。
 * 演示模式（没 Key）直接用内置台词，省得等模型；有 Key 就带着最近聊天生成，避免每次同一句。
 */
function normalizeCareLine(text) {
  return String(text || '').replace(/[\s，。！？!?、~～]+/g, '').trim();
}

function isDuplicateCare(text, recent = []) {
  const want = normalizeCareLine(text);
  if (!want) return true;
  return (recent || []).some((line) => {
    const s = String(line || '');
    if (!s.startsWith('我：')) return false;
    return normalizeCareLine(s.slice(2)).includes(want);
  });
}

function pickFreshTemplate(recent = [], rng = Math.random) {
  for (let i = 0; i < 12; i++) {
    const t = care.pickTemplate(rng);
    if (!isDuplicateCare(t, recent)) return t;
  }
  return '在忙吗，我就问一句';
}

async function careForChat(runtime, chatId) {
  const personaCfg = runtime.config.persona || {};
  const name = String(personaCfg.ownerName || '主人');
  const nowMs = Date.now();
  const tz = time.resolveTimeZone(runtime.config);
  const hour = time.hourOfDay(nowMs, tz);
  const nowText = time.formatDateTime(nowMs, tz);
  let recent = [];
  if (chatId) {
    // 会话 key 可能是私聊（wechat:u:<id>）也可能是群（wechat:g:<id>），两边都试
    for (const key of [`wechat:u:${chatId}`, `wechat:g:${chatId}`, chatId]) {
      try {
        const msgs = runtime.store.messages(key, 12) || [];
        if (msgs.length) {
          recent = msgs
            .filter((m) => m && m.text)
            .map((m) => {
              const stamp = time.formatDateTime(Number(m.ts) || nowMs, tz);
              return `[${stamp}] ${m.role === 'user' ? '对方' : (personaCfg.name || '我')}：${String(m.text).slice(0, 60)}`;
            });
          break;
        }
      } catch {
        recent = [];
      }
    }
  }
  if (runtime.llm.isMock) {
    return { ok: true, text: pickFreshTemplate(recent), mock: true, hour };
  }
  try {
    const desire = care.careDesire(runtime.config);
    const { system, user } = care.buildCarePrompt({
      persona: personaCfg,
      recent,
      name,
      hour,
      nowText,
      want: desire.needy ? desire.want : null,
      wantLine: desire.needy ? desire.line : '',
      interestLine: features.isOn(runtime.config, 'hobbies') && desire.needy ? (hobby.topic(runtime.config, desire.want) || {}).name || '' : '',
    });
    const raw = await runtime.llm.complete({ system, turns: [{ role: 'user', content: user }] });
    let text = care.cleanCareText(raw) || pickFreshTemplate(recent);
    if (isDuplicateCare(text, recent)) {
      // 模型还是复读：只重写一次，明确要求换一句
      try {
        const retry = await runtime.llm.complete({
          system: system + '\n- 你上次刚说过几乎一样的话；这次必须换一个具体话题或说法，不要复读。',
          turns: [{ role: 'user', content: user }],
        });
        const again = care.cleanCareText(retry);
        if (again && !isDuplicateCare(again, recent)) text = again;
      } catch { /* 重写失败就走模板 */ }
    }
    if (isDuplicateCare(text, recent)) text = pickFreshTemplate(recent);
    return { ok: true, text, mock: false, hour };
  } catch (err) {
    runtime.logger.warn('搭话模型失败，用内置台词：' + describeError(err));
    return { ok: true, text: pickFreshTemplate(recent), mock: true, fallback: true, hour };
  }
}

module.exports = { careForChat, isDuplicateCare, normalizeCareLine };
