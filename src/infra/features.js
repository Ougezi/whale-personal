'use strict';

/**
 * 功能开关登记表。
 *
 * 约定（从现在开始每个新功能都要遵守）：
 *   1. 功能必须有开关，默认值写在这里，并进 DEFAULT_CONFIG；
 *   2. 开关必须能通过 API 改；启动器按所属能力专页或设置维护区提供唯一入口；
 *   3. 开关写回 config.json，重启/热重载都还在；
 *   4. 关闭语义按每项说明；布局开关不回滚人格，不能把普通维护项都称为实验功能。
 */

const { getByPath } = require('./objpath');
const { parseBoolean } = require('./configValues');

const REGISTRY = [
  {
    key: 'mood',
    path: 'features.mood',
    label: '情绪状态（三轴 + 七情 + 六欲）',
    desc: '关掉后不读写 data/mood.json，提示词里没有【此刻心情】这一行；开着时情绪有惯性（各有半衰期）、六个欲望会自己饿。',
    default: true,
  },
  {
    key: 'thoughts',
    path: 'features.thoughts',
    label: '念头流（脑子里挂着的事）',
    desc: '关掉后不读写 data/thoughts.json，提示词里没有【脑子里挂着的】。开着时心里挂 3~5 条短念头，跨轮带着、3 小时淡掉。',
    default: true,
  },
  {
    key: 'browse',
    path: 'features.browse',
    label: '自主上网（隔几小时自己刷一条热榜）',
    desc: '关掉后完全不联网、不写 data/browse-state.json。开着时每 180 分钟挑一条没看过的热榜，用自己的话说一句并影响情绪念头（每天最多 5 次）。',
    default: true,
  },
  {
    key: 'stickers',
    path: 'features.stickers',
    label: '表情包（实验性）',
    desc: '默认关闭。开启后可按傲娇、炸毛、其他三类上传表情包；关闭立即取消未发送任务，不挑图、不带回包字段、不轮询，管理接口停用。实验发送只在已打开的目标微信会话前台校验通过时进行，不自动切会话。',
    default: false,
    experimental: true,
  },
  {
    key: 'vectorSearch',
    path: 'features.vectorSearch',
    label: '向量检索（本地嵌入）',
    desc: '开启后事件检索先用 BM25 召回，再用本地 bge-small-zh 向量重排；模型缺失或编码失败自动退回纯 BM25。',
    default: false,
  },
  {
    key: 'mood',
    path: 'features.mood',
    label: '情绪状态（有惯性）',
    desc: '关掉后不读写 data/mood.json，提示词里没有【此刻心情】这一行，回到「每句话从零开始」的旧行为。',
    default: true,
  },
  {
    key: 'thoughts',
    path: 'features.thoughts',
    label: '念头流（脑子里挂着的事）',
    desc: '关掉后不读写 data/thoughts.json，提示词里没有【脑子里挂着的】这一行。开着时她心里会挂 3~5 条短念头，跨轮带着、3 小时自然淡掉，每轮最多带出两条。',
    default: true,
  },
  {
    key: 'browse',
    path: 'features.browse',
    label: '自主上网（隔几小时自己刷一条热榜）',
    desc: '关掉后完全不联网、不写 data/browse-state.json。开着时每 180 分钟挑一条没看过的热榜，用自己的话说一句，再影响情绪与念头（每天最多 5 次，可在 config.browse 调）。',
    default: true,
  },
  {
    key: 'javascriptPlugins', path: 'features.javascriptPlugins',
    label: 'JavaScript 插件（实验性，完整系统权限）',
    desc: '默认关闭。开启后仍须逐个确认插件权限。JavaScript 可访问网络、文件、系统命令及全部主程序 API，只启用信任的作者。关闭会停止受管理的插件进程并取消尚未执行的插件发送任务。',
    default: false, experimental: true,
  },
  {
    key: 'envContext',
    path: 'features.envContext',
    label: '环境信息注入（系统 / 时区 / 所在地）',
    desc: '把本机的系统、架构、时区、所在地拼成 <env> 块放进 system，问「你用的什么系统 / 你那边几点 / 电脑卡不卡」时不用瞎猜。关掉 = system 里没有 <env> 块，回到旧行为。',
    default: true,
  },
  {
    key: 'groupAddressGuard',
    path: 'features.groupAddressGuard',
    label: '群里先分清「你」在说谁',
    desc: '别人之间互相骂、@ 了别人、或在说第三人称时，不去插嘴。关掉=回到以前「她一说过话就接」的旧行为。',
    default: true,
  },
  {
    key: 'fightQuoteCheck',
    path: 'features.fightQuoteCheck',
    label: '开怼前必须引用对方原话',
    desc: '开火时要求回复里带上对方原话的片段（证明她真读懂了）；找不到就降级成一句「？」，不再乱喷。',
    default: true,
  },
  {
    key: 'staticSystem',
    path: 'features.staticSystem',
    label: '系统提示词静态化（前缀缓存）',
    desc: '开启后将本轮状态放在最后一条用户消息，保持系统前缀稳定；关闭后将状态放入 system。只改变位置，不改变人设、顶嘴人格或设置含义。',
    default: true,
  },
  {
    key: 'mediaCleanup',
    path: 'features.mediaCleanup',
    label: '启动时清理媒体缓存',
    desc: '清 data/media-cache 里 7 天前的图片/语音（storage.mediaKeepDays 可调）。关掉=永不清理。',
    default: true,
  },
  {
    key: 'memorySnapshot',
    path: 'features.memorySnapshot',
    label: '自动记忆快照',
    desc: '启动和每 30 分钟备份一次记忆到 data/backups（最多 20 份）。关掉=只保留手动备份。',
    default: true,
  },
  {
    key: 'eventLog',
    path: 'features.eventLog',
    label: '记忆事件日志（实验性）',
    desc: '默认关闭。开启后每条聊天消息旁路写 data/memory-events.jsonl（append-only），旧 messages.jsonl 仍是主链；事件写失败只记日志，不影响聊天。',
    default: false,
    experimental: true,
  },
  {
    key: 'relations',
    path: 'features.relations',
    label: '群聊关系加载（A 提到 B）',
    desc: '群里有人提到另一个人时，把「两人的关系 + 那个人的卡 + 最近说过的话」加载进提示词。只是给模型看的内部状态，启动器上看不到正文。关掉=不加载关系块（已记录的关系边保留，重新打开还能用）。',
    default: true,
  },
  {
    key: 'wechatAccountGuard',
    path: 'wechat.accountGuard',
    label: '微信双开时钉死账号（认不出就不发）',
    desc: '同时登着大号小号时，只从指定账号的窗口发消息；认不出窗口宁可不发，避免用小号读、从大号发出去。',
    default: true,
  },
  {
    key: 'momentsPublish',
    path: 'moments.publishFeatureEnabled',
    label: '朋友圈发表总开关（实验性）',
    desc: '默认关闭。开启后可以测试发表，也可以单独设置定时发表。',
    default: false,
    experimental: true,
  },
  {
    key: 'careOnlyMaster',
    path: 'care.onlyMaster',
    label: '主动搭话只找主人',
    desc: '开着就是「只私聊你」；关掉才会主动找别人（配合下面两个开关）。',
    default: true,
  },
  {
    key: 'careGroups',
    path: 'care.allowGroups',
    label: '主动搭话允许进群',
    desc: '默认关：群里突然来一句「早安」很社死。打开也只是「可以发群」，不会主动挑群。',
    default: false,
  },
  {
    key: 'careOthers',
    path: 'care.allowOthers',
    label: '主动搭话找非主人的私聊',
    desc: '默认关。打开后她会主动私聊别人（不只是你）。',
    default: false,
  },
  {
    key: 'proactiveCare',
    path: 'care.enabled',
    label: '主动找话题（群聊里绝不主动）',
    desc: '没聊的时候她自己来一句「在干啥」。默认开但只私聊，不会进群；群里突然说早安很容易社死。',
    default: true,
  },
  {
    key: 'quoteReply',
    path: 'wechat.quoteReply',
    label: '引用回复（慢，默认关）',
    desc: '开启后每条回复都带「引用原消息」，视觉上更清楚，但每条要多走一遍 UI，实测慢好几秒。',
    default: false,
  },
];

const BY_KEY = new Map(REGISTRY.map((f) => [f.key, f]));

/** 开关是否打开（读配置；没配就用默认值） */
function toBool(value, fallback = false) {
  if (value === undefined || value === null) return fallback;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  const s = String(value).trim().toLowerCase();
  if (!s) return false;
  const parsed = parseBoolean(s);
  return parsed === undefined ? fallback : parsed;
}

function isOn(config, key) {
  const f = BY_KEY.get(key);
  if (!f) return false;
  return toBool(getByPath(config, f.path), f.default);
}

/** 给启动器和接口看的：所有开关 + 当前值 */
function list(config) {
  return REGISTRY.map((f) => ({
    key: f.key,
    path: f.path,
    label: f.label,
    desc: f.desc,
    value: isOn(config, f.key),
    default: f.default,
    experimental: Boolean(f.experimental),
  }));
}

/** 默认值对象，塞进 DEFAULT_CONFIG */
function defaults() {
  const out = { features: {} };
  for (const f of REGISTRY) {
    if (!f.path.startsWith('features.')) continue;
    out.features[f.path.slice('features.'.length)] = f.default;
  }
  return out.features;
}

module.exports = { REGISTRY, isOn, list, defaults, getByPath, toBool };
