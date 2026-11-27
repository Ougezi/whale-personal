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

const ACTION_CLAIM = /这次(?:是真的|真的|是)?真?写|我(?:是真的|是|真的|真)?写了|我写了一张|(?<!你)写好了(?!\s*[吗?？])|我写完了|我画了|我拍了|我画好了|我拍好了/;

function stripUnbackedActionClaims(text) {
  const t = String(text || '');
  if (!ACTION_CLAIM.test(t)) return t;
  // 只要出现“我写了一张/这次是真写/写好了”这类没有工具结果的动作，整句换成诚实回复。
  return '我没法真的动笔，只能在脑子里想一句。';
}

const DOC_EMPTY_CLAIM = /内容空|内容为空|文件本身(?:就)?(?:是)?空|文件是空|文件本身读不出来|读不出来|(?:文件|文档|pdf|PDF|手册).{0,12}(?:空|没收到|没拿到|没读到|读不出|打不开|空白)|(?:没收到|没拿到|没读到|空的).{0,12}(?:文件|文档|pdf|PDF|手册)/;

function stripFalseDocumentClaims(text, { mediaFail = '' } = {}) {
  const why = String(mediaFail || '');
  if (!why || !/(找不到|没缓存|下载失败)/.test(why)) return String(text || '');
  if (!DOC_EMPTY_CLAIM.test(String(text || ''))) return String(text || '');
  return '这个文件没有下载到本地，我这边打不开，不是内容空。你在聊天里点一下文件让它下载，或把文字贴过来。';
}

const RESEARCH_CLAIM = /查到了|我查了|搜到了|查到(?:了|过)|我搜了/;

function stripUnbackedResearchClaims(text, { searched = false } = {}) {
  const t = String(text || '');
  if (!RESEARCH_CLAIM.test(t) || searched) return t;
  return '我没真的查到可靠来源，刚才那些不能当准；我先把查到的东西放一放。';
}

const BROWSE_CLAIM = /我(?:刚|刚才|刚刚)?刷(?:回来|完|了)|刚刷回来|我刷回来了/;

function stripUnbackedBrowseClaims(text) {
  const t = String(text || '');
  if (!BROWSE_CLAIM.test(t)) return t;
  return '我没法真的刷抖音/B站，刚才那些是按印象说的，链接我没有。';
}

function isImmediateDuplicate(text, recent = []) {
  const last = (recent || [])[recent.length - 1];
  if (!last || last.role !== 'assistant') return false;
  const a = norm(text);
  const b = norm(last.text);
  return Boolean(a && b && a === b);
}

module.exports = { stripRepeatedArrival, stripUnbackedActionClaims, stripUnbackedBrowseClaims, stripUnbackedResearchClaims, stripFalseDocumentClaims, isImmediateDuplicate, ARRIVAL };
