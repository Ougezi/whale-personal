'use strict';
/**
 * 出生技能 · 表达层：人格只影响语气，执行结果不被改写。
 *
 * 工作原文 origin 永远保留；需要“换口吻”时，只把 masked prose 交给外部
 * rephrase（可由模型/人格层实现），代码/路径/URL/命令/版本先变成 [[n]]，
 * 还原后逐字校验。marker 缺失/重复/越界 => 整段回退原文。
 *
 * 本步只做纯函数；不接现有 pipeline/prompt。
 */
const MARKER = /\[\[\s*(\d+)\s*\]\]/g;

const PATTERNS = [
  /(`{3,}|~{3,})[^\n]*\n[\s\S]*?(?:\n\1[ \t]*(?=\n|$)|$)/,
  /`[^`\n]+`/,
  /https?:\/\/[^\s<>"'`\u3000-\u303f\uff00-\uffef]+/,
  /[A-Za-z]:\\[^\s"',;:)\]|]+/,
  /(?<![\w.-])\/(?:[\w.@+-]+\/?)+/,
  /\b(?:npm|npx|pnpm|yarn|node|python|pip|git|cargo|go|dotnet|java|mvn|gradle|docker|kubectl|make|cmake|curl|wget|ssh|scp|rsync|systemctl|brew|apt|choco|deno|bun)\b(?:[ \t]+(?:-{1,2}[\w-]+|[\w./@:=+-]+))+/,
  /\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/,
  /\bv?\d+\.\d+\.\d+(?:-[\w.]+)?\b/,
];
const STICKY = PATTERNS.map((re) => new RegExp(re.source, (re.flags || '').replace(/[gy]/g, '') + 'y'));

function mask(input) {
  const s = String(input == null ? '' : input);
  const literals = [];
  let out = '';
  let i = 0;
  while (i < s.length) {
    let best = '';
    for (const re of STICKY) {
      re.lastIndex = i;
      const m = re.exec(s);
      if (m && m[0].length > best.length) best = m[0];
    }
    if (!best) { out += s[i]; i += 1; continue; }
    out += '[[' + literals.length + ']]';
    literals.push(best);
    i += best.length;
  }
  return { masked: out, literals };
}

function markers(text) {
  const found = [];
  for (const m of String(text || '').matchAll(MARKER)) found.push(Number(m[1]));
  return found;
}

function unmask(text, literals) {
  return String(text || '').replace(MARKER, (_all, d) => {
    const i = Number(d);
    return Array.isArray(literals) && literals[i] !== undefined ? literals[i] : `[[${d}]]`;
  });
}

function markersValid(text, expected) {
  const got = markers(text);
  if (got.length !== expected) return false;
  for (let i = 0; i < expected; i++) if (got[i] !== i) return false;
  return true;
}

/**
 * 生成一个“人格视图”：origin 永远不变，display 只是派生表达。
 * @param {{report:string, rephrase?:Function, style?:object}} opts
 */
function renderExpression({ report, rephrase, style = {} } = {}) {
  const origin = String(report == null ? '' : report);
  const { masked, literals } = mask(origin);
  const fallback = () => ({ origin, display: origin, changed: false, fallback: true, literals: literals.length, style });
  if (!origin.trim() || typeof rephrase !== 'function') {
    return { origin, display: origin, changed: false, fallback: false, literals: literals.length, style };
  }
  let candidate;
  try {
    candidate = rephrase(masked, style);
  } catch (e) {
    return { ...fallback(), error: String(e && e.message || e) };
  }
  if (typeof candidate !== 'string' || !markersValid(candidate, literals.length)) {
    return { ...fallback(), error: 'marker-mismatch' };
  }
  const display = unmask(candidate, literals);
  return {
    origin,
    display,
    changed: display !== origin,
    fallback: false,
    literals: literals.length,
    technicalPreserved: unmask(masked, literals) === origin && mask(origin).literals.join('\n') === literals.join('\n'),
    style,
  };
}

module.exports = { mask, unmask, markers, markersValid, renderExpression };
