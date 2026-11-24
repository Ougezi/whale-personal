// 纯文本防护：静默/表情标记、上下文长度判定、朋友圈意图、管理命令词（2026-11 拆自 chat.js）
'use strict';

const MOMENTS_INTENT_RE = /朋友圈|动态|谁发了|发了(?:什么|啥)|最近发了|看看.*(?:朋友圈|动态)|点赞/;

/**
 * 把模型写的 ((silence:分钟)) 标记抠出来，返回 { text, minutes }。
 * 标记只用于「群里被赶走」：宿主校验会话和时长后才落盘，正文里绝不外泄。
 *
 * 用圆括号而不是方括号：表情包的 [[sticker:分类]] 也用 [[]]，两套语法必须分开。
 * 只认 ((silence))，不保留旧的 [[silence:]] 写法 —— 4.1.0 还没发布，没有历史用户，
 * 同时认两种只会让弱模型更爱写错。
 * 不用一条大正则：模型常见的写法（少一边括号、写「10分钟」、没有冒号）都要能认，
 * 没闭合时只删到这一行末尾，不吞后面的段落。
 */
function stripSilenceMark(input) {
  let text = String(input == null ? '' : input);
  let minutes = 0;
  let from = 0;
  while (from <= text.length) {
    const lower = text.toLowerCase();
    const open = lower.indexOf('((', from);
    if (open < 0) break;
    let i = open + 2;
    while (i < lower.length && (lower[i] === ' ' || lower[i] === '\t')) i++;
    if (lower.slice(i, i + 7) !== 'silence') { from = open + 2; continue; }
    const bodyStart = i + 7;
    const close = text.indexOf('))', bodyStart);
    const lineEnd = text.indexOf('\n', bodyStart);
    const hasClose = close >= 0 && (lineEnd < 0 || close < lineEnd);
    const stop = hasClose ? close + 2 : (lineEnd < 0 ? text.length : lineEnd);
    const body = text.slice(bodyStart, hasClose ? close : (lineEnd < 0 ? text.length : lineEnd));
    const m = body.match(/(\d{1,3})/);
    if (!minutes && m) {
      const v = Number(m[1]);
      if (Number.isFinite(v) && v > 0) minutes = v;
    }
    text = text.slice(0, open) + text.slice(stop);
    from = open;
  }
  return { text: text.trim(), minutes };
}

/**
 * 把正文里的 [[sticker:分类]] 标记抠干净，返回 { text, category }。
 *
 * 不用正则：模型有时把标记写在开头还没闭合，`[[sticker[\s\S]*$` 这类贪心写法
 * 会把整条回复吃光（用户那边就是「她突然不说话」）。这里逐个字符扫描：
 *   1. 小写副本里找 '[['，位置与原串一一对应（ASCII 大小写同长度）；
 *   2. 跳过空白后必须是 'sticker'（兼容 "[[ sticker : 炸毛"），再跳到分隔符；
 *   3. 有 ':' / '：' 才算给了分类，分类名去空白后 1~40 字且不含换行；
 *   4. 有 ']]' 删到 ']]'；没闭合就删到这一行末尾（不吞后面的段落）；
 *      没有分隔符只删标记本身。
 * 最多处理 3 个，全部删掉但只取第一个分类名。
 */
function stripStickerMarks(input) {
  let text = String(input == null ? '' : input);
  let category = '';
  let count = 0;
  let from = 0;
  while (count < 3) {
    const lower = text.toLowerCase();
    const open = lower.indexOf('[[', from);
    if (open < 0) break;
    let i = open + 2;
    while (i < lower.length && (lower[i] === ' ' || lower[i] === '\t')) i++;
    if (lower.slice(i, i + 7) !== 'sticker') { from = open + 2; continue; }
    let j = i + 7;
    while (j < lower.length && (lower[j] === ' ' || lower[j] === '\t')) j++;
    const hasDelimiter = lower[j] === ':' || lower[j] === '：';
    const start = hasDelimiter ? j + 1 : j;
    const close = text.indexOf(']]', start);
    let stop;
    if (close >= 0) {
      stop = close + 2;
      if (hasDelimiter && !category) category = text.slice(start, close);
    } else if (hasDelimiter) {
      // 没闭合：删到行尾，后面的段落不动；分类名最多取到行尾
      const lineEnd = text.indexOf('\n', start);
      stop = lineEnd < 0 ? text.length : lineEnd;
      if (!category) category = text.slice(start, stop);
    } else {
      stop = close === start ? close + 2 : start;
    }
    if (stop <= open) stop = Math.min(text.length, open + 9);
    text = text.slice(0, open) + text.slice(stop);
    count++;
    from = open;
  }
  category = String(category).split('\r').join('').split('\n').join('').trim();
  if (category.length < 1 || category.length > 40) category = '';
  return { text: text.trim(), category };
}

/**
 * 服务商报「上下文超长」时，不能把整段历史原样再发一次，也不该退化成只留当前一句。
 * 这里只认明确的上下文错误，别把普通 400 内容审核也当成超长。
 */
function isContextLengthError(err) {
  const text = [
    err && err.message,
    err && err.detail,
    err && err.userMessage,
    err && err.code,
  ].filter(Boolean).join(' ');
  return /context[_\s-]?length|maximum\s+context|context\s+(?:window|size).*(?:exceed|too\s+long)|too\s+many\s+tokens|(?:request|prompt|input|message|context)\s+(?:is\s+)?too\s+long|exceed(?:s|ed)?\s+(?:the\s+)?(?:maximum\s+)?context/i.test(text);
}

function momentsIntent(text) {
  return MOMENTS_INTENT_RE.test(String(text == null ? '' : text));
}

/** 管理员能用的全部命令：魔咒验证成功后直接回这份清单，配「帮助」也用它 */
function adminCommandList() {
  return [
    '状态',
    '改名 <新名字>',
    '上下文 20 / 上下文 短|中|长',
    '主动 开|关 / 观点 开|关 / 互怼 开|关',
    '长度 私聊 120 / 回复 短一点|长一点',
    '颜文字 关|少|正常|多',
    '能力 链接 开|关 / 能力 主动接话 开|关',
    '禁言 群名 / 禁言列表 / 解除禁言 群名',
    '改模型 <模型名>',
    '演示模式 开|关',
    '重置记忆 / 清空所有记忆',
    '恢复默认',
    '退出管理',
  ];
}

module.exports = { stripSilenceMark, stripStickerMarks, isContextLengthError, momentsIntent, adminCommandList };
