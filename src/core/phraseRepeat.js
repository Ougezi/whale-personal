'use strict';
// 同一件事的重复叮嘱：不是逐字复读，而是每条都追“到家说一声”。
const ARRIVAL = /(?:到家|回家|到了)[^。！？\n]{0,18}(?:说|吱|报|告诉|发)[^。！？\n]{0,10}(?:声|消息|一句)?/;
const CLAUSE = /[^。！？\n]+[。！？]?/g;

function norm(s) {
  return String(s || '').replace(/\s+/g, '').replace(/[，。！？!?、~～]/g, '');
}

function countRecent(recent) {
  return (recent || []).filter((m) => m && m.role === 'assistant' && ARRIVAL.test(String(m.text || ''))).length;
}

/**
 * 最近 3 条里已经说过两次以上“到家说一声”，当前这句再劝就删掉。
 * 只删含该意图的短句，不动主内容；删空给一句不催的短句。
 */
function stripRepeatedArrival(text, recent = []) {
  const t = String(text || '');
  if (!t || countRecent((recent || []).slice(-6)) < 2) return t;
  if (!ARRIVAL.test(t)) return t;
  const kept = [];
  for (const clause of t.match(CLAUSE) || []) {
    if (!ARRIVAL.test(clause)) { kept.push(clause); continue; }
    // 只删逗号分隔的那一小段，保留“路上小心”这种主内容。
    const parts = clause.split(/(?<=[，,、])/);
    for (const part of parts) if (!ARRIVAL.test(part)) kept.push(part);
  }
  let out = kept.join('').trim();
  out = out.replace(/[，,、]\s*[。！？!?]/g, '。').replace(/\n{2,}/g, '\n').trim();
  return out || '好，不催了。';
}

module.exports = { stripRepeatedArrival, ARRIVAL };
