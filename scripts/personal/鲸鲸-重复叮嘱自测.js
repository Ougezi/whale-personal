'use strict';
const assert = require('node:assert');
const { stripRepeatedArrival, isImmediateDuplicate } = require('../../src/core/phraseRepeat.js');
let p=0,f=0;
function c(n,fn){try{fn();p++;console.log('  ✓ '+n);}catch(e){f++;console.log('  ✗ '+n+' '+e.message);}}
const twice=[{role:'assistant',text:'到家了跟我说一声。'},{role:'assistant',text:'路上小心，到家说一声。'}];
c('连续两次后删除',()=>assert.ok(!stripRepeatedArrival('好，路上小心，到家了跟我说一声。',twice).includes('到家')));
c('保留主内容',()=>assert.ok(stripRepeatedArrival('好，路上小心，到家了跟我说一声。',twice).includes('路上小心')));
c('只出现一次不删',()=>assert.strictEqual(stripRepeatedArrival('到家了跟我说一声。',[twice[0]]),'到家了跟我说一声。'));
c('无叮嘱不改',()=>assert.strictEqual(stripRepeatedArrival('今天有点累。',twice),'今天有点累。'));
c('全删给不催短句',()=>assert.strictEqual(stripRepeatedArrival('到家了跟我说一声。',twice),'好，不催了。'));
c('连续 assistant 同句拦截',()=>assert.strictEqual(isImmediateDuplicate('在呢主人，怎么啦',[{role:'assistant',text:'在呢主人，怎么啦'}]),true));
c('有 user 不拦',()=>assert.strictEqual(isImmediateDuplicate('在呢主人，怎么啦',[{role:'assistant',text:'在呢主人，怎么啦'},{role:'user',text:'在吗'}]),false));
c('不同句不拦',()=>assert.strictEqual(isImmediateDuplicate('嗯',[{role:'assistant',text:'在呢主人，怎么啦'}]),false));
console.log('\n通过 '+p+'/'+(p+f));
process.exit(f?1:0);
