'use strict';
const assert = require('node:assert');
let p = 0, f = 0;
function load(name, fn) { try { fn(); p++; console.log('  ✓ ' + name); } catch (e) { f++; console.log('  ✗ ' + name + ' ' + e.message); } }
load('memory/store 可加载', () => require('../../src/memory/store.js'));
load('pipeline/chat 可加载', () => require('../../src/pipeline/chat.js'));
load('pipeline/finalGuards 可加载', () => require('../../src/pipeline/finalGuards.js'));
load('core/expressionPolicy 可加载', () => require('../../src/core/expressionPolicy.js'));
load('core/feedbackLedger 可加载', () => require('../../src/core/feedbackLedger.js'));
load('services/hobby 可加载', () => require('../../src/services/hobby.js'));
load('services/careChat 可加载', () => require('../../src/services/careChat.js'));
load('adapters/stickers 可加载', () => require('../../src/adapters/stickers.js'));
console.log('\n通过 ' + p + '/' + (p + f));
process.exit(f ? 1 : 0);
