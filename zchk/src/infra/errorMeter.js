// 异常计数：静默吞掉可以，但要能看见（2026-11-22 架构审查）
// 只统计不打扰：/api/health 里能看到「哪类错误最多」。
'use strict';

const COUNTS = {};
const TAGS_MAX = 40;

function bump(tag) {
  const key = String(tag || 'unknown').slice(0, TAGS_MAX);
  COUNTS[key] = (COUNTS[key] || 0) + 1;
}

function stats() {
  const entries = Object.entries(COUNTS).sort((a, b) => b[1] - a[1]);
  const total = entries.reduce((sum, x) => sum + x[1], 0);
  return { total, top: Object.fromEntries(entries.slice(0, 10)) };
}

function reset() { for (const k of Object.keys(COUNTS)) delete COUNTS[k]; }

module.exports = { bump, stats, reset };
