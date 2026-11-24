// 漏回提醒：重启/断线后，主人前面几条 user 没有 assistant 回复。
// 不主动补发消息，只在下一次回复时提醒她自然接上，避免「你上面怎么不回消息」。
'use strict';

function hint(messages, { now = Date.now(), currentSeq = 0, minAgeMs = 15 * 60 * 1000, maxItems = 3 } = {}) {
  const list = Array.isArray(messages) ? messages : [];
  let lastAssistant = 0;
  for (const m of list) {
    if (m.role === 'assistant' && Number(m.seq) > lastAssistant) lastAssistant = Number(m.seq) || 0;
  }
  const unanswered = list.filter((m) => m.role === 'user'
    && Number(m.seq) > lastAssistant
    && Number(m.seq) !== Number(currentSeq)
    && now - (Number(m.ts) || 0) >= Math.max(0, Number(minAgeMs) || 0));
  if (!unanswered.length) return '';
  const pick = unanswered.slice(-Math.max(1, Number(maxItems) || 3));
  const fmt = (ts) => {
    const d = new Date(Number(ts) || 0);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  };
  const parts = pick.map((m) => `${fmt(m.ts)} ${String(m.text || '').replace(/\s+/g, ' ').slice(0, 20)}`);
  return `【补一句】你之前有 ${unanswered.length} 条没回（${parts.join('；')}）。` +
    '如果合适，先自然接一下，别装作没看见；不用逐条道歉，也不要编没发生的事。';
}

module.exports = { hint };
