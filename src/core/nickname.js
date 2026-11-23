// 改称呼识别（2026-11-24）：主人说「以后叫你 X / 不叫你 X」时给她一条明确提示
'use strict';

const CALL_RE = /以后(?:就|都|只)?(?:叫你|喊你|称呼你)\s*([\u4e00-\u9fa5A-Za-z0-9_]{1,8})/;
const STOP_RE = /以后不叫你|别再叫我|不许叫我/;

function hint(text) {
  const s = String(text == null ? '' : text);
  const m = CALL_RE.exec(s);
  if (m) return `【改称呼】主人以后要叫你「${m[1]}」；直接接受并记住，不要反问“我该叫什么”。`;
  if (STOP_RE.test(s)) return '【改称呼】主人不想再叫某个名字了；顺着接受，别追问“那我该叫什么”。';
  return '';
}

module.exports = { hint, CALL_RE, STOP_RE };
