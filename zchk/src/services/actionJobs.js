'use strict';
/** I-16：把 action-core/job.js 接成 kernel 侧 Job 账本。 */
const { createJob } = require('../../packages/action-core/job.js');

function createActionJobs({ logger = null } = {}) {
  const jobs = new Map();

  function apply(body = {}) {
    const op = String(body.op || '').trim();
    if (op === 'create') {
      const id = String(body.id || '').trim();
      if (!id) return { ok: false, error: 'id required' };
      if (jobs.has(id)) return { ok: true, duplicate: true, job: jobs.get(id).snapshot() };
      const job = createJob({ id, risk: body.risk || 'R0', action: body.action || '', goal: body.goal || '', timeoutMs: body.timeoutMs });
      jobs.set(id, job);
      return { ok: true, job: job.snapshot() };
    }
    const id = String(body.id || '').trim();
    const job = jobs.get(id);
    if (!job) return { ok: false, error: 'unknown job' };
    try {
      if (op === 'approve') job.approve(body.approver || 'owner');
      else if (op === 'start') job.start();
      else if (op === 'finish') {
        if (body.ok) job.succeed(body.value == null ? null : body.value);
        else job.fail(body.reason || 'failed');
      } else if (op === 'cancel') job.cancel();
      else if (op === 'stop') job.markStopped();
      else return { ok: false, error: 'unknown op' };
      return { ok: true, job: job.snapshot() };
    } catch (e) {
      return { ok: false, error: e && e.message };
    }
  }

  function get(id) { return jobs.get(String(id))?.snapshot() || null; }
  function stats() { return { total: jobs.size, running: [...jobs.values()].filter((j) => j.snapshot().state === 'running').length }; }
  return { apply, get, stats };
}

module.exports = { createActionJobs };
