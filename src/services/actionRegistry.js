'use strict';
/** I-21：action-core/registry 的只读目录/参数校验；执行策略仍以 Python action_guard 为准。 */
const { listActions, getAction, validateAction, approvalsFor } = require('../../packages/action-core/registry.js');

function catalog() {
  return listActions().map((x) => ({ id: x.id, label: x.label, risk: x.risk,
    requiresApproval: x.requiresApproval, permissions: x.permissions,
    executor: x.executor, verifier: x.verifier, args: x.args, approvals: approvalsFor(x.risk) }));
}
function get(id) { const x = getAction(id); return x ? { ...x, approvals: approvalsFor(x.risk) } : null; }
function validate(id, args) { return validateAction(id, args); }
module.exports = { catalog, get, validate, approvalsFor };
