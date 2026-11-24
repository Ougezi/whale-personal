// 指代提示（2026-11-24）：对方说「那个/刚才/上面」时，别当新话题
'use strict';

const REF_RE = /(那个|刚才|刚刚|上面|前面|之前说|刚说)/;

function hint(text) {
  const s = String(text == null ? '' : text);
  if (!REF_RE.test(s)) return '';
  return '【指代】对方在说刚才/上面的事，结合最近几轮理解，不要当成新话题。';
}

module.exports = { hint, REF_RE };
