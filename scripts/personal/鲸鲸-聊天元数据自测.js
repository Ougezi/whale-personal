'use strict';
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ChatStore } = require('../../src/memory/chatStore.js');
let p=0,f=0;
function c(n,fn){try{fn();p++;console.log('  ✓ '+n);}catch(e){f++;console.log('  ✗ '+n+' '+e.message);}}
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'whale-meta-'));
const store=new ChatStore({dir});
const chat=store.ensureChat('wechat:u:test',{platform:'wechat',chatType:'private'});
const e=store.appendMessage(chat,{role:'assistant',name:'鲸鲸',text:'care',delivery:'submitted',deliveryUncertain:true});
c('返回值带 delivery',()=>assert.strictEqual(e.delivery,'submitted'));
const raw=JSON.parse(fs.readFileSync(path.join(chat.dir,'messages.jsonl'),'utf8').trim());
c('落盘带 delivery',()=>assert.strictEqual(raw.delivery,'submitted'));
c('落盘带 uncertain',()=>assert.strictEqual(raw.deliveryUncertain,true));
console.log('\n通过 '+p+'/'+(p+f));
process.exit(f?1:0);
