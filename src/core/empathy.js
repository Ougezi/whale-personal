// 共情前置（R2，2026-11-23）：规则版，不调模型，只决定回话温度
'use strict';

function assess(text, moodState = null) {
  const s = String(text == null ? '' : text);
  if (/(生气|气死|烦死|恶心|滚开?|闭嘴|受不了|无语)/.test(s)) return { tone: 'soothe', why: '对方在气头上' };
  if (/(哭|难受|委屈|难过|崩了|想哭|压力大)/.test(s)) return { tone: 'soothe', why: '对方情绪低' };
  if (/(在忙|忙着|开会|赶工|稍后|晚点说)/.test(s)) return { tone: 'brief', why: '对方在忙' };
  const v = Number(moodState && moodState.valence);
  if (Number.isFinite(v) && v < -0.3) return { tone: 'soothe', why: '气氛有点沉' };
  return { tone: 'normal', why: '' };
}

function line(result) {
  if (!result || !result.why) return '';
  return `【TA 现在】${result.why}；回话${result.tone === 'brief' ? '短一点，别拖' : '先接住情绪再讲事'}。`;
}

module.exports = { assess, line };
