'use strict';
/**
 * 出生技能 · 记忆核心：append-only 事件日志。
 *
 * 只做三件事：
 *  1. 事件只追加，不覆盖；
 *  2. event.id 幂等，重复追加返回 duplicate；
 *  3. 读回时跳过崩溃留下的半行，并提供 recover() 截断到最后一个完整行。
 *
 * 不直接改现有 memory/store；B1-04 才做双写/迁移。
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

function sha256(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

function validEvent(input) {
  if (!input || typeof input !== 'object') return 'event must be object';
  if (!input.id || typeof input.id !== 'string' || input.id.length > 160) return 'id required';
  if (!input.type || typeof input.type !== 'string' || input.type.length > 120) return 'type required';
  if (!Number.isSafeInteger(input.at) || input.at < 0) return 'at must be int';
  if (!input.source || typeof input.source !== 'object') return 'source required';
  if (!input.scope || typeof input.scope !== 'object') return 'scope required';
  if (input.evidence !== undefined && !Array.isArray(input.evidence)) return 'evidence must be array';
  return '';
}

function createEventStore({ file, fsync = true } = {}) {
  if (!file) throw new Error('file required');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  let ids = new Set();
  let count = 0;

  function scan() {
    let raw = '';
    try { raw = fs.readFileSync(file, 'utf8'); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    const events = [];
    const lines = raw.split(/\r?\n/);
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const ev = JSON.parse(line);
        if (validEvent(ev)) continue;
        events.push(ev);
      } catch { /* 半行/坏行：读时跳过，recover 负责截断 */ }
    }
    ids = new Set(events.map((e) => e.id));
    count = events.length;
    return events;
  }

  function readAll() { return scan(); }

  function append(input) {
    const why = validEvent(input);
    if (why) throw new Error('invalid event: ' + why);
    if (ids.has(input.id)) return { ok: true, duplicate: true, event: null };
    const event = {
      id: input.id,
      type: input.type,
      at: input.at,
      source: input.source,
      scope: input.scope,
      payload: input.payload === undefined ? {} : input.payload,
      evidence: input.evidence === undefined ? [] : input.evidence,
    };
    const line = JSON.stringify(event) + '\n';
    const fd = fs.openSync(file, 'a');
    try {
      fs.writeSync(fd, Buffer.from(line, 'utf8'));
      if (fsync) fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    ids.add(event.id);
    count += 1;
    return { ok: true, duplicate: false, event };
  }

  function replay(reducer, initial) {
    let acc = initial;
    for (const ev of readAll()) acc = reducer(acc, ev);
    return acc;
  }

  /** 截断到最后一个完整 JSON 行；崩在半行时用。 */
  function recover() {
    let raw = '';
    try { raw = fs.readFileSync(file, 'utf8'); } catch (e) { if (e.code === 'ENOENT') return { ok: true, kept: 0, dropped: 0 }; throw e; }
    const parts = raw.split(/\r?\n/);
    const valid = [];
    for (const line of parts) {
      if (!line.trim()) continue;
      try {
        const ev = JSON.parse(line);
        if (!validEvent(ev)) valid.push(line);
      } catch { /* drop */ }
    }
    const out = valid.length ? valid.join('\n') + '\n' : '';
    const dropped = raw.split(/\r?\n/).length - 1 - valid.length;
    if (out !== raw) fs.writeFileSync(file, out, 'utf8');
    const events = scan();
    return { ok: true, kept: events.length, dropped: Math.max(0, dropped) };
  }

  function stats() {
    const events = readAll();
    return {
      events: events.length,
      bytes: (() => { try { return fs.statSync(file).size; } catch { return 0; } })(),
      lastAt: events.length ? events[events.length - 1].at : 0,
    };
  }

  scan();
  return { append, readAll, replay, recover, stats, file, hash: (ev) => sha256(JSON.stringify(ev)) };
}

module.exports = { createEventStore, validEvent, sha256 };
