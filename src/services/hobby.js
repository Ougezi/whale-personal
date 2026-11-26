'use strict';
/** 兴趣账本的 IO/业务入口；是否进 prompt 由 features.hobbies 决定。 */
const path = require('node:path');
const core = require('../core/hobby');

function dirOf(config) {
  const dir = config && config.paths && config.paths.dataDir;
  return dir || path.join(process.cwd(), 'data');
}
function load(config) { return core.load(dirOf(config)); }
function save(config, doc) { return core.save(dirOf(config), doc); }
function record(config, evidence) {
  const doc = core.observe(load(config), evidence || {});
  if (doc.changed && doc.state) save(config, doc.state);
  return doc;
}
function recordText(config, { text = '', role = 'user', ref = '', kind = '', weight = 0, at = Date.now() } = {}) {
  if (!ref) return { ok: false, reason: 'ref-required' };
  const ev = core.detectEvidence(text, role);
  if (!ev.tags.length) return { ok: false, reason: 'no-interest' };
  let doc = load(config);
  let changed = 0;
  for (const tag of ev.tags) {
    const out = core.observe(doc, { kind: kind || ev.kind, ref, at, weight: weight || ev.weight, tags: [tag] });
    if (out.changed) { doc = out.state; changed += 1; }
  }
  if (changed) save(config, doc);
  return { ok: changed > 0, changed, tags: ev.tags };
}
function detect(text, role = 'user') { return core.detectEvidence(text, role); }
function line(config) { return core.promptLine(load(config)); }
function topic(config, desire) { return core.pickTopic(load(config), desire); }
function status(config) {
  const d = load(config);
  return { count: d.interests.length, active: d.interests.filter((x) => ['attached', 'practicing', 'exploring'].includes(x.status)).length, interests: d.interests.map((x) => ({ id: x.id, name: x.name, status: x.status, strength: x.strength })) };
}
function init(config) {
  const dir = dirOf(config);
  const doc = core.load(dir);
  if (!doc.interests.length) core.empty();
  return core.save(dir, doc);
}
module.exports = { load, save, record, recordText, detect, line, topic, status, init, dirOf };
