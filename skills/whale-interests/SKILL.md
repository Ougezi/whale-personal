---
name: whale-interests
description: 鲸鲸兴趣爱好账本的可执行 runbook：证据驱动的兴趣状态机、3 个真实种子、24 个候选、prompt 旁路、默认关。Use when the owner says 兴趣爱好 / 兴趣账本 / 给她设计爱好 / 开始 P0 兴趣.
---

# 鲸鲸 · 兴趣爱好系统（P0/P1）

> 设计：[鲸鲸-兴趣爱好-设计.md](../../docs/personal/鲸鲸-兴趣爱好-设计.md)
> 种子：[鲸鲸-兴趣爱好-种子.json](../../docs/personal/鲸鲸-兴趣爱好-种子.json)
> 原则：兴趣 = 领域 + 证据 + 强度 + 阶段 + 表达边界。没有 `ref` 不收证据。

## 0. 一条命令执行

```powershell
cd D:\\dsh\\whale-personal\\src

$env:PYTHONIOENCODING = 'utf-8'
python skills\whale-interests\scripts\run_all.py --execute
```

执行：

```text
1. 兴趣自测 12/12
2. 证据自测 8/8
3. 初始化 data/interests.json（没有才建）
4. 校验 3 个真实种子
5. 确认 features.hobbies=false
6. 写证据 data/integration/evidence/I-49.json
```

**不会**改 prompt、不会开启兴趣、不会发消息。

---

## 1. 三个真实种子

```text
collect-small-things  攒票根/贴纸/糖纸
rain-smell            雨后的味道
small-notes           手写小纸条
```

来自真实聊天，不是模型编的。  
另外 21 个只放在 `鲸鲸-兴趣爱好-种子.json`，是候选，不直接激活。

---

## 2. 状态机

```text
seed → exploring → practicing → attached
                         ↓
                      cooling → dormant → revive
```

限制：

```text
attached 最多 3
exploring 最多 2
休眠不删除
复活需要真实证据
```

---

## 3. 证据门

只收：

```text
self-disclosure / owner-shared / browse-hit
platform-read / diary-reflection / practice-log
```

必须：

```text
kind + ref + at + weight
```

没有 `ref` 直接拒绝。

---

## 4. 接入点

```text
src/core/hobby.js       纯状态
src/services/hobby.js   文件 IO
src/pipeline/chat.js    features.hobbies + hobbies.chats 白名单
src/infra/features.js   hobbies 默认 false
src/infra/config.js     hobbies.chats=[]
```

prompt 只在同时满足时加：

```text
features.hobbies=true
当前 chat 在 hobbies.chats
```

内容最多 3 行：

```text
【我的兴趣】
- 攒小东西：喜欢；只说自己真的留着的，不编新买
- 雨后的味道：喜欢；只说想了解，不编经历
```

---

## 5. 表达边界

```text
一次回复最多 1 个兴趣
同一兴趣 6 轮内不重复
同一天主动提最多 2 次
不把“想了解”说成“我做过”
不拿兴趣索要钱/礼物
不拿群友私事当素材
```

示例：

```text
可以：我盒子里还留着几张糖纸，翻出来挺有意思。
可以：雨后的味道我还没闻到，你那边下了吗？
不可以：我今天去买了新票根。
不可以：你给我买一盒吧。
```

---

## 6. 启用（需要主人明确）

```powershell
# 只给一个测试 chat 开
$body = @{ key='hobbies'; value=$true } | ConvertTo-Json -Compress
Invoke-RestMethod -Method Post -Uri http://127.0.0.1:8787/api/features -ContentType 'application/json' -Body $body
```

还要设置 `hobbies.chats` 白名单；空名单不生效。  
不要一次全量打开。

---

## 7. 验收

```text
3 个种子存在
无 ref 证据拒绝
14 天 cooling
30 天 dormant
休眠可复活
默认 hobbies=false
prompt 不编新经历
```

测试：

```text
node scripts/personal/鲸鲸-兴趣爱好自测.js  12/12
node scripts/personal/鲸鲸-兴趣爱好证据自测.js  8/8
python skills/whale-mainline-integration/scripts/verify_all.py
```

---

## 8. 不做

```text
不一次激活 24 个
不把主人偏好当她的兴趣
不把“看过”说成“做过”
不把兴趣写成口头禅
不为了兴趣向主人要钱
不跑 1000 条全量
```

---

## 9. 回滚

```text
1. features.hobbies=false
2. hobbies.chats=[]
3. 删除 data/interests.json 即回到无兴趣层
4. 不改 messages.jsonl
```
