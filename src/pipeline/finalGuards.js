'use strict';
const phrase = require('../core/phraseRepeat');

/**
 * finalize 前的纯文本守卫组合。只做文本变换，不碰 IO/网络。
 * 返回 { drop, text }；drop=true 表示整条不发送（连续重复）。
 */
function applyFinalGuards(text, { recent = [], mediaFail = '', searched = false, userText = '' } = {}) {
  let t = String(text || '');
  if (!t) return { drop: false, text: '' };
  if (phrase.isImmediateDuplicate(t, recent)) return { drop: true, text: '' };
  t = phrase.stripRepeatedArrival(t, recent);
  t = phrase.stripUnbackedBrowseClaims(t);
  t = phrase.stripUnbackedResearchClaims(t, { searched });
  t = phrase.stripFalseDocumentClaims(t, { mediaFail });
  t = phrase.stripDefensiveFileTone(t, { mediaFail });
  t = phrase.stripFalseTruncationAdmission(t, { userText, recent });
  t = phrase.stripUnbackedActionClaims(t);
  return { drop: false, text: t };
}
module.exports = { applyFinalGuards };
