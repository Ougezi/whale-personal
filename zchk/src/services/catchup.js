'use strict';
/**
 * 漏回补答（catch-up）
 *
 * 只做三件事：
 *   1) 判断主人私聊里有没有“最后一次 assistant 之后、当前之前”的未回消息；
 *   2) 生成一句短补答（≤maxChars、≤2 气泡）；
 *   3) 在桥接确认发送后，由路由写入 assistant 并记 throughSeq。
 *
 * 不在这一层直接发送，也不在生成时就写记忆，避免“记了没发/重复发”。
 */

const { matchMaster } = require('../core/master');

const DEFAULTS = {
  enabled: true,
  minAgeMinutes: 2,
  maxAgeHours: 6,
  quietStart: '23:00',
  quietEnd: '08:00',
  cooldownHours: 6,
  maxPerDay: 2,
  maxChars: 80,
  maxBubbles: 2,
  fallbackTemplate: false,
  startupDelaySec: 20,
};

function cfgOf(config) {
  return { ...DEFAULTS, ...((config && config.catchup) || {}) };
}

function dayKey(now) {
  const d = new Date(now);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

function minutesOf(value) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(value || '').trim());
  if (!m) return null;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  if (h < 0 || h > 23 || mi < 0 || mi > 59) return null;
  return h * 60 + mi;
}

function inQuietHours(now, cfg) {
  const start = minutesOf(cfg.quietStart);
  const end = minutesOf(cfg.quietEnd);
  if (start == null || end == null || start === end) return false;
  const d = new Date(now);
  const cur = d.getHours() * 60 + d.getMinutes();
  return start < end ? (cur >= start && cur < end) : (cur >= start || cur < end);
}

/** 主会话判定：只认 wechat 私聊 + master.wxids */
function isMasterPrivate(config, chat) {
  if (!chat || chat.chatType !== 'private' || chat.platform !== 'wechat') return false;
  const m = /^wechat:u:(.+)$/.exec(String(chat.chatId || ''));
  if (!m) return false;
  try {
    return matchMaster(config, { platform: 'wechat', senderId: m[1], chatType: 'private' }).isMaster === true;
  } catch {
    return false;
  }
}

/**
 * 收集未回消息。
 * @returns {{missed:Array, throughSeq:number, lastAssistantSeq:number, ageMs:number}}
 */
function collect(messages, { now = Date.now(), maxItems = 6 } = {}) {
  const list = Array.isArray(messages) ? messages : [];
  let lastAssistant = 0;
  let lastAssistantText = '';
  for (const m of list) {
    if (m.role === 'assistant' && Number(m.seq) >= lastAssistant) {
      lastAssistant = Number(m.seq) || 0;
      lastAssistantText = String(m.text || '');
    }
  }
  const missed = list.filter((m) => m.role === 'user'
    && Number(m.seq) > lastAssistant
    && String(m.text || '').trim());
  const throughSeq = missed.reduce((n, m) => Math.max(n, Number(m.seq) || 0), 0);
  const last = missed[missed.length - 1];
  return {
    missed: missed.slice(-Math.max(1, Number(maxItems) || 6)),
    throughSeq,
    lastAssistantSeq: lastAssistant,
    lastAssistantText: lastAssistantText.slice(0, 120),
    ageMs: last ? Math.max(0, now - (Number(last.ts) || 0)) : 0,
  };
}

/**
 * 判断是否需要补答。
 * @returns {{needed:boolean, reason:string, throughSeq?:number, missed?:Array, lastAssistantSeq?:number, lastAssistantText?:string}}
 */
function evaluate({ config, chat, messages, now = Date.now() } = {}) {
  const cfg = cfgOf(config);
  if (!cfg.enabled) return { needed: false, reason: 'disabled' };
  if (!isMasterPrivate(config, chat)) return { needed: false, reason: 'not_master' };

  const back = collect(messages, { now });
  if (!back.missed.length || !back.throughSeq) return { needed: false, reason: 'no_missed' };

  const meta = (chat && chat.meta) || {};
  const state = meta.catchup || {};
  if (Number(state.throughSeq) >= back.throughSeq) return { needed: false, reason: 'already_replied' };

  const maxAge = Math.max(1, Number(cfg.maxAgeHours) || 6) * 3600000;
  if (back.ageMs > maxAge) return { needed: false, reason: 'too_old' };
  const minAge = Math.max(0, Number(cfg.minAgeMinutes) || 0) * 60000;
  if (back.ageMs < minAge) return { needed: false, reason: 'too_new' };

  if (inQuietHours(now, cfg)) return { needed: false, reason: 'quiet_hours' };

  if (state.sentAt && now - Number(state.sentAt) < Math.max(1, Number(cfg.cooldownHours) || 6) * 3600000) {
    return { needed: false, reason: 'cooldown' };
  }
  const today = dayKey(now);
  const dayCount = state.dayKey === today ? Number(state.dayCount) || 0 : 0;
  if (dayCount >= Math.max(1, Number(cfg.maxPerDay) || 2)) return { needed: false, reason: 'daily_limit' };

  return {
    needed: true,
    reason: 'ok',
    throughSeq: back.throughSeq,
    missed: back.missed,
    lastAssistantSeq: back.lastAssistantSeq,
    lastAssistantText: back.lastAssistantText,
  };
}

function buildPrompt(config, chat, back) {
  const cfg = cfgOf(config);
  const lines = (back.missed || []).map((m) => {
    const d = new Date(Number(m.ts) || 0);
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    return `- ${hh}:${mm} ${String(m.text || '').replace(/\s+/g, ' ').slice(0, 40)}`;
  }).join('\n');
  const system = [
    '你是鲸鲸。主人前面有几条消息，因为重启/断线没有回。',
    '写一句自然的补答：先承认刚看到/刚才断了，不要逐条道歉，不要编造没发生的事；',
    `自然接上最后一条的内容，最多 2 句、${Math.max(20, Number(cfg.maxChars) || 80)} 字以内；`,
    '不要提系统/模型/日志/API，不要解释技术原因；不要重复主人原话，不要客服腔。',
  ].join('');
  const user = [
    '漏回的消息：',
    lines,
    back.lastAssistantText ? `\n你最后说的是：${back.lastAssistantText}` : '',
    '\n只输出补答正文，不要引号、不要前缀。',
  ].filter(Boolean).join('\n');
  return { system, user };
}

function cleanText(raw, maxChars) {
  let text = String(raw == null ? '' : raw).trim();
  text = text.replace(/^["'“”]+|["'“”]+$/g, '').trim();
  text = text.replace(/^(鲸鲸|我)[:：]\s*/, '').trim();
  const lines = text.split(/\r?\n/).map((x) => x.trim()).filter(Boolean).slice(0, 2);
  text = lines.join('\n');
  const limit = Math.max(20, Number(maxChars) || 80);
  if (text.length > limit) text = text.slice(0, limit).trim();
  return text;
}

async function generate(runtime, chat, back) {
  const cfg = cfgOf(runtime.config);
  const { system, user } = buildPrompt(runtime.config, chat, back);
  const raw = await runtime.llm.complete({
    system,
    turns: [{ role: 'user', content: user }],
    maxTokens: 200,
    purpose: 'catchup',
  });
  let text = cleanText(raw, cfg.maxChars);
  if (!text && cfg.fallbackTemplate) {
    text = '刚看到你前面几条，我这边断线漏掉了，不是故意不理你。';
  }
  if (!text) return '';
  // 生成结果再校验一次：最多 maxBubbles 行
  text = text.split(/\r?\n/).slice(0, Math.max(1, Number(cfg.maxBubbles) || 2)).join('\n');
  return text;
}

module.exports = {
  DEFAULTS,
  cfgOf,
  dayKey,
  minutesOf,
  inQuietHours,
  isMasterPrivate,
  collect,
  evaluate,
  buildPrompt,
  cleanText,
  generate,
};
