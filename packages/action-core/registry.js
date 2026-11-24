'use strict';
/**
 * 出生技能 · 动作注册表（B3-01）。
 *
 * 动作是枚举，不是自由文本。每个 ActionSpec 声明：
 *  - 风险 R0–R3；
 *  - 是否需要审批/审批次数；
 *  - 执行器/验证器；
 *  - 参数白名单与必填。
 *
 * 本步只做注册表/校验；执行策略/Job 在 B3-02/B3-03。
 */
const APPROVALS = Object.freeze({ R0: 0, R1: 0, R2: 1, R3: 2 });
const RISKS = new Set(['R0', 'R1', 'R2', 'R3']);

const SPECS = [
  {
    id: 'inspect', label: '只读查看项目/日志/状态', risk: 'R0', requiresApproval: false,
    permissions: ['fs.read'], executor: 'brain', verifier: 'read_back',
    args: { goal: { type: 'string', required: true, max: 500 } },
  },
  {
    id: 'read', label: '只读指定文件', risk: 'R0', requiresApproval: false,
    permissions: ['fs.read'], executor: 'bridge', verifier: 'read_back',
    args: { path: { type: 'string', required: true, max: 260 } },
  },
  {
    id: 'run_test', label: '跑项目测试', risk: 'R2', requiresApproval: true,
    permissions: ['process.spawn'], executor: 'brain', verifier: 'test_result',
    args: { goal: { type: 'string', required: true, max: 500 }, workspace: { type: 'string', required: false, max: 260 } },
  },
  {
    id: 'edit', label: '改工作区文件', risk: 'R2', requiresApproval: true,
    permissions: ['fs.write.workspace'], executor: 'brain', verifier: 'read_back',
    args: { path: { type: 'string', required: true, max: 260 }, content: { type: 'string', required: true, max: 20000 } },
  },
  {
    id: 'create_file', label: '新建工作区文件', risk: 'R2', requiresApproval: true,
    permissions: ['fs.write.workspace'], executor: 'brain', verifier: 'read_back',
    args: { path: { type: 'string', required: true, max: 260 }, content: { type: 'string', required: true, max: 20000 } },
  },
  {
    id: 'delete', label: '删除文件/目录', risk: 'R3', requiresApproval: true,
    permissions: ['fs.write.workspace'], executor: 'brain', verifier: 'tombstone',
    args: { path: { type: 'string', required: true, max: 260 }, reason: { type: 'string', required: true, max: 300 } },
  },
  {
    id: 'restart', label: '重启桥接/内核', risk: 'R3', requiresApproval: true,
    permissions: ['process.lifecycle'], executor: 'launcher', verifier: 'health',
    args: { target: { type: 'string', required: true, enum: ['bridge', 'kernel', 'all'] } },
  },
  {
    id: 'send_message', label: '向聊天发送消息', risk: 'R2', requiresApproval: true,
    permissions: ['channel.send'], executor: 'bridge', verifier: 'receipt',
    args: { chat: { type: 'string', required: true, max: 120 }, text: { type: 'string', required: true, max: 2000 } },
  },
];

const BY_ID = new Map();
for (const s of SPECS) {
  if (BY_ID.has(s.id)) throw new Error('duplicate action ' + s.id);
  if (!RISKS.has(s.risk)) throw new Error('bad risk ' + s.id);
  if (s.risk === 'R2' || s.risk === 'R3') {
    if (s.requiresApproval !== true) throw new Error('R2/R3 must require approval: ' + s.id);
  }
  BY_ID.set(s.id, Object.freeze({ ...s, args: Object.freeze({ ...s.args }) }));
}

function listActions() { return [...BY_ID.values()].map((s) => ({ ...s, args: { ...s.args } })); }
function getAction(id) { return BY_ID.get(String(id || '')) || null; }
function approvalsFor(risk) { return APPROVALS[risk] || 0; }

function validateAction(id, args = {}) {
  const spec = getAction(id);
  if (!spec) return { ok: false, action: null, errors: ['unknown-action'] };
  const errors = [];
  const input = args && typeof args === 'object' ? args : {};
  for (const key of Object.keys(input)) {
    if (!spec.args[key]) errors.push('unknown-arg:' + key);
  }
  for (const [key, rule] of Object.entries(spec.args)) {
    const v = input[key];
    if (rule.required && (v === undefined || v === null || String(v).trim() === '')) {
      errors.push('missing:' + key); continue;
    }
    if (v === undefined || v === null) continue;
    if (rule.type === 'string' && typeof v !== 'string') errors.push('type:' + key);
    if (rule.type === 'string' && rule.max && String(v).length > rule.max) errors.push('max:' + key);
    if (rule.enum && !rule.enum.includes(v)) errors.push('enum:' + key);
  }
  return { ok: errors.length === 0, action: spec, errors, approvals: approvalsFor(spec.risk) };
}

module.exports = { APPROVALS, SPECS, listActions, getAction, validateAction, approvalsFor };
