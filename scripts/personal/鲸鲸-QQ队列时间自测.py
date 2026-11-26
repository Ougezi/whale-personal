# -*- coding: utf-8 -*-
"""QQ 桥接队列：补投刷新当前时间，过期主动搭话不重放。"""
import os
p=r'D:\surfcore\src\bridge.js'
s=open(p,encoding='utf-8').read() if os.path.exists(p) else ''
P=F=0
def c(n,x):
 global P,F
 if x: P+=1; print('  ✓ '+n)
 else: F+=1; print('  ✗ '+n)
c('refreshPromptTime 存在', 'function refreshPromptTime' in s)
c('补投刷新时间', 'refreshPromptTime(item.promptText)' in s)
c('队列带 at', 'at: Date.now()' in s)
c('过期主动搭话丢弃', '补投丢弃过期主动搭话' in s)
print('\n通过 %d/%d'%(P,P+F))
raise SystemExit(0 if F==0 else 1)
