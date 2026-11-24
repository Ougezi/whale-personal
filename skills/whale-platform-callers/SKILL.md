---
name: whale-platform-callers
description: 鲸鲸真实平台调用方 runbook：GitHub/抖音/B站只读 adapter、PlatformBroker、24 案例、标记入口与 9 个桥接契约落点。Use when the owner says 真实调用方 / 平台调用 / GitHub 查询 / B站查询 / 抖音只读 / 24 案例 / 接 command_bus 等.
---

# 鲸鲸 · 真实平台调用方（P0）

> 目标：不是再写 9 个类，而是让 GitHub / 抖音 / B站有**真实调用链**，再把 9 个契约挂到该挂的位置。
> 默认：只读、默认关、无标记不联网。

---

## 0. 一条命令执行

```powershell
cd D:\dsh\whale-personal\src

$env:PYTHONIOENCODING = 'utf-8'
python skills\whale-platform-callers\scripts\run_all.py --live
```

带抖音 sidecar 健康检查：

```powershell
python skills\whale-platform-callers\scripts\run_all.py --live --douyin
```

运行内容：

```text
1. 24 条离线契约自测
2. 24 条 live 平台案例（GitHub/B站）
3. 可选抖音 sidecar status
4. 写 data/integration/evidence/I-36-live.json
5. 返回 0/1
```

**不会**执行写操作、不会 push、不会点赞/评论、不会改 `messages.jsonl`。

---

## 1. 前置检查

```powershell
curl http://127.0.0.1:8787/healthz
```

桥接是否加载新模块：

```text
bridge/platform_agent.py
bridge/platform_broker.py
bridge/platform_github.py
bridge/platform_bilibili.py
bridge/platform_douyin.py
```

检查：

```powershell
python -m py_compile `
  bridge\platform_agent.py `
  bridge\platform_broker.py `
  bridge\platform_github.py `
  bridge\platform_bilibili.py `
  bridge\platform_douyin.py `
  bridge\receiver_mixin.py
```

---

## 2. 开关与安全边界

### 2.1 运行时开关

默认不认平台标记：

```text
没有 WHALE_PLATFORM_CALLS=1
  → platform_agent.extract() 原样返回
  → 不联网
```

启用：

```powershell
$env:WHALE_PLATFORM_CALLS = '1'
```

然后**重启桥接进程**，新环境变量才会生效。  
不设置时，即使回复里出现 `[[gh:...]]`，也不会执行，标记会原样保留。

### 2.2 只读白名单

```text
GitHub:  api.github.com，只读 repo/readme/issues/pulls/actions/release
B站:     api.bilibili.com，只读 view/search/comments/user
抖音:    复用现有 sidecar，只读 hot/watch/user/comments/download/live/status
```

写操作：

```text
GitHub push/comment     不做
B站 点赞/评论/投币      不做
抖音 like/collect        adapter 直接返回 approval-required
```

### 2.3 token

```text
GITHUB_TOKEN 只从环境变量读取
不写日志、不写证据、不进 prompt、不进回复
匿名 GitHub 60/h；有 token 5000/h
B站默认无登录 cookie
```

---

## 3. 调用链

```text
她回复：[[gh:repo:octocat/Hello-World]]
  → receiver_mixin 抽取
  → platform_agent.extract()
  → platform_agent.run()
  → PlatformBroker.dispatch_spec()
  → GitHubAdapter
  → Verifier（readback + tests）
  → receipt
  → _post_note 交给内核转述
```

B站同理：

```text
[[bili:view:BV1GJ411x7h7]]
[[bili:comments:BV1GJ411x7h7]]
[[bili:search:原神]]
[[bili:user:2]]
```

GitHub：

```text
[[gh:repo:octocat/Hello-World]]
[[gh:readme:octocat/Hello-World]]
[[gh:issues:cli/cli]]
[[gh:issue:cli/cli:1]]
[[gh:pulls:cli/cli]]
[[gh:actions:cli/cli]]
[[gh:release:cli/cli]]
```

---

## 4. 接口

### 4.1 `platform_agent`

```python
available()                  # WHALE_PLATFORM_CALLS == "1"
extract(text) -> (clean, spec)
run(spec) -> (ok, text)
```

### 4.2 `PlatformBroker`

```python
PlatformBroker(adapters, verifier=None, audit=None)
.dispatch(platform, op, args, approved=False, action_id=None)
.dispatch_spec('gh:repo:owner/name')
.capabilities()
.available()
```

返回：

```json
{
  "ok": true,
  "text": "给内核转述的事实",
  "data": {},
  "evidence": {
    "readback": "github:repo:200:...:hash",
    "tests": ["http-200", "json"],
    "source": "https://api.github.com/..."
  },
  "receipt": {"state": "success"}
}
```

### 4.3 Adapter

```python
available() -> dict
capabilities() -> [{'op':..., 'risk':'R1'}]
execute(op, args) -> dict
```

---

## 5. 9 个契约的落点

| 契约 | P0 状态 | 落点 |
|---|---|---|
| `command_bus` | 未接 | 出站回复/写动作 outbox；不是平台读总线 |
| `verify` | **已接** | Broker 每个成功结果都必须有 readback/tests |
| `shadow` | 未接 | 新平台写操作上线前 |
| `rollout` | 未接 | adapter 版本 10/50/100 |
| `redteam` | 未接 | 平台注入/路径/凭据测试 |
| `birth_config` | 未接 | 启动/设置页三技能开关 |
| `evolution.approval` | 未接 | 平台写操作 R2/R3 |
| `evolution.genome` | 未接 | adapter 版本登记 |
| `evolution.sandbox` | 未接 | adapter 改动沙箱 |

> P0 只接真实调用方和 `verify`；其余 8 个必须等有真实调用点再接，不能为了矩阵好看硬接。

---

## 6. 24 条案例

### GitHub 8

```text
GH-01 repo
GH-02 readme
GH-03 issues
GH-04 issue
GH-05 pulls
GH-07 actions
GH-08 release
GH-09 404（预期 not-found）
```

### B站 8

```text
BL-01 view
BL-02 search（412 时预期 risk-control）
BL-03 comments
BL-04 user
BL-05 无效 BV（预期 bad-bvid）
BL-06 412 映射
BL-07 429 映射
BL-08 评论注入只当数据
```

### 抖音 8

```text
DY-01 只读白名单
DY-02 hot 契约
DY-03 like 未批准（预期 approval-required）
DY-04 collect 未批准（预期 approval-required）
DY-05 watch 契约
DY-06 comments 契约
DY-07 download 目录约束
DY-08 timeout/no-output 映射
```

“预期失败”的案例，返回对应 code 才算通过；不把 404/412 伪装成成功。

---

## 7. 验收

```text
离线自测 24/24
live 24/24（含预期错误码）
无标记 0 网络
只读 0 写
成功都有 readback/tests
token 0 泄漏
证据写入 data/integration/evidence/I-36-live.json
```

`run_all.py` 返回 0 才算通过。

---

## 8. 失败处理

### GitHub 403

```text
rate-limit
→ 等一小时 / 配 GITHUB_TOKEN
```

### GitHub 404

```text
not-found
→ 检查 owner/name
```

### B站 412

```text
risk-control
→ 这是 B站风控，不是代码 bug
→ 保留失败，不重试刷接口
```

### B站 429

```text
rate-limit
→ 退避，不并行刷
```

### 抖音 spawn-failed

```text
检查 sidecar:
  D:\dsh\profiles\desktop\whale-douyin\service.mjs
  dist\whale-personal\runtime\node.exe
```

### 抖音 sidecar 不可用

```text
DY-01..08 contract 仍通过
live status 标记 skipped
不要在回复里声称“刷到了”
```

---

## 9. 回滚

```text
1. 取消 WHALE_PLATFORM_CALLS
2. 重启桥接
3. 删除 data/migration 之外的缓存（可选）
4. 不回滚 messages.jsonl / memory
```

只读调用不写业务数据；失败最多留下 `I-36-live.json`。

---

## 10. 不做

```text
不为 9 个契约硬造调用方
不让 GitHub/B站 adapter 执行 shell/写文件
不把 token 放进 prompt/args
不把 404/412/429 伪装成成功
不把抖音写操作默认打开
不跑 1000 条全量；先 24 条，再按类别扩
```

---

## 11. 下一步

P0 通过后：

```text
P1  Broker -> shadow / receipt 全链
P2  平台写操作 + approval（默认关）
P3  rollout / genome / sandbox / redteam / birth_config
```
