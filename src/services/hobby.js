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
function line(config, chatKey = '') {
  let d = load(config);
  const ticked = core.tick(d);
  if (ticked !== d) { d = ticked; save(config, d); }
  return core.promptLine(d, { chatKey });
}
function markMention(config, chatKey, text, at = Date.now()) {
  const d = core.markMention(load(config), { chatKey, text, at });
  if (d) save(config, d);
  return Boolean(d);
}
function topic(config, desire) {
  let d = load(config);
  d = core.tick(d); save(config, d);
  return core.pickTopic(d, desire);
}
function names(config) {
  const d = load(config);
  return d.interests.filter((x) => ['seed', 'attached', 'practicing', 'exploring'].includes(x.status)).sort((a, b) => b.strength - a.strength).slice(0, 3).map((x) => x.name);
}
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
module.exports = { load, save, record, recordText, detect, line, markMention, topic, names, status, init, dirOf };
