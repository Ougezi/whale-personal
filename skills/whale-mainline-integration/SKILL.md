---
name: whale-mainline-integration
description: 鲸鲸主链接入与结构治理的可执行 runbook：按 I-01..I-27 过案例/源码/测试/证据/回滚门禁，接 kernel/bridge、job/receipts、动作硬审批、action-audit、dist 全量同步，并分 L0-L5 做真实微信/真实动作/热停验收。Use when the owner says 主链接入 / 接入主链 / 结构治理 / 下一步接入 / 热停 / 端到端验收 / 真实微信验收 / 核心包接入.
---

# whale-mainline-integration

这是**执行器**，不是设计文档。  
出生技能负责“核心模块存在”；本 skill 负责“核心模块真的接进鲸鲸主链，并且有可复查的证据”。

## 0. 开工先跑三条

```bash
cd D:\dsh\whale-personal\src

python skills/whale-mainline-integration/scripts/next_step.py
python skills/whale-mainline-integration/scripts/integration_check.py --check
python skills/whale-mainline-integration/scripts/verify_all.py --quick
```

判断：

- `next_step.py` 退出 0 = 没有 pending/blocked；
- `integration_check.py --check` 退出 0 = 计划/证据/状态一致；
- `verify_all.py --quick` 14/14 = 核心回归绿。

任何一条不绿：先修，不继续下一步。

---

## 1. 固定路径

```text
仓库       D:\dsh\whale-personal\src
计划       docs/personal/鲸鲸-主链接入-执行计划.json
目录       docs/personal/鲸鲸-主链接入-执行总目录.md
验收       docs/personal/鲸鲸-主链接入-验收.md
案例       docs/personal/鲸鲸-出生技能-案例库-313.json
状态       data/integration/state.json
证据       data/integration/evidence/<step>.json
审计       data/integration/audit.jsonl
运行产物   dist/whale-personal
源码数据备份（更新器可能移动） D:\dsh\whale-personal\_local-data-backup
```

运行时二进制：

```text
NODE=dist\whale-personal\runtime\node.exe
PY  =dist\whale-personal\runtime\python\python.exe
```

---

## 2. 运行态与进程

正常拓扑：

```text
WhaleLauncher.exe --autostart
  ├─ node server.js --no-browser       127.0.0.1:8787
  └─ python examples\wechatauto_bridge.py
```

检查：

```bash
curl -s http://127.0.0.1:8787/healthz
powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'WhaleLauncher.exe' -or ($_.CommandLine -like '*whale-personal*' -and ($_.Name -eq 'node.exe' -or $_.Name -eq 'python.exe')) } | Select ProcessId,ParentProcessId,Name"
```

重启原则：

- **不要**用后台 job 直接跑 `WhaleLauncher.exe`，job 结束会回收子进程；
- 用 `Start-Process` 脱离，或先杀旧进程再 detached 启动；
- 只改配置可热加载；改 `.js/.py` 必须同步 dist + 重启。

---

## 3. 命令路由

| 用户说 | 执行 |
|---|---|
| 主链接入状态 | `next_step.py --json` + `integration_check.py` |
| 主链接入下一步 | `next_step.py` |
| 主链接入执行 I-XX | 按第 4 节循环 |
| 主链接入验收 | `verify_all.py`（必要时 `--real`） |
| 主链接入回滚 | 第 12 节 |
| 主链接入热停 | 第 11 节 |
| 主链接入 E2E | 第 7 节，按 L0→L5 |
| 核心包矩阵 | `鲸鲸-核心包接入检查.py --check` |
| dist 同步 | 第 8 节 |

---

## 4. 单步执行循环（强制顺序）

```text
1. 读 plan/state/evidence
2. 选第一个 pending/blocked step
3. CASE_GATE
4. SOURCE_GATE
5. 默认关 + fail-open 最小实现
6. TEST_GATE
7. 同步 dist
8. LIVE_GATE（按步骤要求）
9. 写 evidence + audit + state
10. commit + push
```

### 4.1 CASE_GATE

- 该步 `case_ids` ≥ `min_cases`（默认 5，计划预选 8）；
- 每个 id 必须存在于 313 案例库；
- 证据必须写实际 id；
- 少于 5 条：停下来补案例，不许 0 案例开工；
- 0–1000 口径：当前 313，可扩到 1000；每步只取相关的 5–20 条。

查案例：

```bash
python - <<'PY'
import json
d=json.load(open('docs/personal/鲸鲸-出生技能-案例库-313.json',encoding='utf-8'))
ids={x['id'] for x in d.get('items',[])}
print(sorted(ids)[:10], len(ids))
PY
```

### 4.2 SOURCE_GATE

先读真实调用点，不猜：

```text
kernel: src/app.js / src/pipeline/chat.js / src/memory/* / src/persona/*
bridge: bridge/app.py / receiver_mixin.py / sender_mixin.py / brain_agent.py / dsh_agent.py
```

外部源码要写：

```json
{"repo":"owner/name","commit":"...","file":"...","license":"...","learned":"模式，不是整段抄"}
```

本地代码要写调用点与行号。

### 4.3 实现门禁

- 新能力默认关；
- 失败 fail-open 到旧主链：
  - eventSink 失败只 warn；
  - prompt block 异常返回空；
  - guard 异常不阻断旧链；
- R2/R3 未审批执行 0；
- 越界路径 0；
- 网络未允许 0；
- 不把 `local=true` dry-run 当真实微信。

### 4.4 TEST_GATE

本步测试 + 回归：

```bash
python skills/whale-mainline-integration/scripts/verify_all.py --quick
```

全量：

```bash
python skills/whale-mainline-integration/scripts/verify_all.py
```

真实动作（会写审计/测试文件）：

```bash
python skills/whale-mainline-integration/scripts/verify_all.py --real
```

### 4.5 写证据

`data/integration/evidence/<step>.json`：

```json
{
  "version": 1,
  "step": "I-XX",
  "status": "done",
  "case_ids": ["...8..."],
  "source_reviews": [],
  "changes": ["src/..."],
  "tests": {"pass": 0, "fail": 0, "commands": ["..."]},
  "acceptance": [{"item": "...", "ok": true, "evidence": "..."}],
  "rollback": "git checkout -- ...",
  "audit": [{"at": 0, "step": "I-XX", "action": "...", "actor": "owner", "risk": "R0", "evidence": "..."}],
  "finishedAt": 0
}
```

没有证据 = 没完成。blocked 也必须写 reason。

### 4.6 更新状态

`data/integration/state.json`：

- 上一步 done 才下一步；
- 失败标 blocked，不跳；
- 全部 done 才 `"complete": true`；
- 每步写 `status/evidence/finishedAt`。

### 4.7 提交

```bash
git add <本步源码/测试/计划/证据说明>
git commit -m "I-XX ..."
```

不提交 `data/`、密钥、dist 运行产物。

---

## 5. 18 步目录

| ID | 内容 | 关键验收 |
|---|---|---|
| I-01 | 记忆事件双写 | eventLog 8/8，kernel 287 |
| I-02 | working/session/instruction 接 prompt | 8/8 |
| I-03 | 发送口 SendGuard/回执 | 9/9，bridge 110 |
| I-04 | 执行脑 ActionSpec 闸 | 10/10 |
| I-05 | 真实微信 + 真实 R2 + 备份回滚 | L3/L4 done |
| I-06 | eventLog 热停/热开 | 27→27 / 27→29 |
| I-07 | 统一动作审计 | brain + delegation 双写 |
| I-08 | 核心包接入矩阵 | 11 Node + 13 桥接 |
| I-09 | 源码-dist 同步检查 | 关键文件 SHA |
| I-10 | 委托硬审批 + brain_policy | 未确认 run_task=0 |
| I-11 | 审计事实源收敛 | brain-audit 只投影 |
| I-12 | 真实动作审计复测 | delegation_done + brain done |
| I-13 | retrieval core | 默认关，失败回退 |
| I-14 | 去重/LRU/轮转 | 23 唯一，LRU 64，5MB |
| I-15 | dist 全量/P3 | 287 文件/6 排除/0 漂移 |
| I-16 | job.js | R2 未批不能 start |
| I-17 | receipts.js | pending→sent→delivered |
| I-18 | 真实写任务硬审批 | 未确认不写，确认后 i18-ok |
| I-19 | 真实微信写审批 | 微信挂起 → 可以 → i18-wechat.txt=wechat-ok |
| I-20 | commitment 记录 | 默认关、落盘、record-only |
| I-21 | registry 只读目录 | 8 个 ActionSpec，不替代 action_guard |
| I-22 | migrate dry-run | 20 行预览，target 不写 |
| I-23 | persona shadow | 默认关，只写 persona-shadow.jsonl |
| I-24 | Shadow A/B | <20 或质量不足拒绝；授权不自动替换 |
| I-25 | affectCore | 默认关；Core 心情行；不替换旧 mood |
| I-26 | affectCore 白名单 | 空名单不生效，只认名单内 chat |
| I-27 | affectCore 黑盒试跑 | 5 轮无报错/无泄漏；质量结论待主人 |

详细命令/文件/验收在计划 JSON；本 skill 只规定方法。

---

## 6. 回归矩阵（当前基线）

```text
结构治理          12/12
检索 core          6/6
Job 账本           9/9
回执账本           7/7
回执轮转           5/5
委托审批           9/9
动作审计           9/9
双路径审计         9/9
核心包矩阵        11/11
dist 同步         10/10
kernel          287/287
bridge          110/110
执行脑           41/41
出生技能          11/11
selfcheck        true
```

失败处理：

1. 看最后 3 行输出；
2. 先修测试/实现；
3. 再跑本步 + 全量；
4. 仍失败：回滚本步，标 blocked，不许跳。

---

## 7. E2E 分级

| 级别 | 内容 | 可以说 |
|---|---|---|
| L0 | 源码单测 | 只能“源码通过” |
| L1 | dist 构建产物 E2E | 只能“构建产物通过” |
| L2 | 运行中 kernel local dry-run | 只能“内核 dry-run” |
| L3 | 真实微信入站 + UIA 出站 | 可“真实微信收发”，注明 submitted |
| L4 | 真实 R2 动作 + 备份回滚 | 可“真实动作” |
| L5 | 热停/热开 | 可“热回滚” |

### L2 命令

```bash
curl -s http://127.0.0.1:8787/healthz
# POST /webhook/wechat，body 带 local=true，header x-whale-bridge: 1
```

### L3

需要主人在微信发消息；不能自导自演。  
出站 UIA `submitted` ≠ 确认送达。

### L4

```bash
PYTHONIOENCODING=utf-8 dist/whale-personal/runtime/python/python.exe scripts/personal/鲸鲸-主链审计真实动作.py
PYTHONIOENCODING=utf-8 dist/whale-personal/runtime/python/python.exe scripts/personal/鲸鲸-主链真实写审批.py
```

### L5

```bash
# 只改 features.eventLog，不重启
# 关闭后事件应停写；开回后恢复
```

---

## 8. dist 同步

### 8.1 关键清单

```bash
PYTHONIOENCODING=utf-8 dist/whale-personal/runtime/python/python.exe scripts/personal/鲸鲸-dist同步检查.py --check
```

### 8.2 全量清单

```bash
PYTHONIOENCODING=utf-8 dist/whale-personal/runtime/python/python.exe scripts/personal/鲸鲸-dist同步检查.py --all --check
```

当前：

```text
287 个文件
6 个明确排除
0 漂移
```

排除项必须写原因；不允许静默跳过。  
新增源文件默认进入全量清单；确实不部署的加入 `EXCLUDED`。

### 8.3 同步规则

```bash
D=dist/whale-personal
cp "$D/path/file" "$D/path/file.bak-iXX" 2>/dev/null || true
cp path/file "$D/path/file"
```

同步后：

1. `node --check` / `py_compile`；
2. `--all --check` 必须 0；
3. 重启（代码改动）。

---

## 9. 核心包矩阵

```bash
PYTHONIOENCODING=utf-8 dist/whale-personal/runtime/python/python.exe scripts/personal/鲸鲸-核心包接入检查.py --check
```

规则：

- `wired`：有真实调用点、测试、证据；
- `not-wired`：有模块/有测试，但运行时仍走旧实现；
- 不把“有测试”写成“已上线”。

当前：

```text
wired: events / working / retrieval / job / receipts
not-wired: registry / commitment / migrate / affect / expression / scope
```

---

## 10. 动作、审批、审计、Job、回执

### 10.1 审计

唯一事实源：

```text
data/action-audit.jsonl
```

`brain-audit.jsonl` 只是投影，字段：

```json
{"source":"brain|delegation","taskId":"...","action":"...","status":"...","risk":"R2","mode":"workspace-write","goal":"...","reason":"...","durationMs":0}
```

### 10.2 硬审批

委托写任务：

```text
R2：1 次「可以」
R3：2 次「可以」
拒绝/5 分钟：不执行
```

未确认 `run_task` 调用必须为 0。

### 10.3 Job

```text
/api/actions/jobs
  create → awaiting_approval
  start（未批）→ 400
  approve → queued
  start → running
  finish → succeeded/failed
```

### 10.4 回执

```text
sender_mixin._post_receipt
  → /api/bridge/receipt
  → receiptLedger
  → receipts.js
```

`delivered` 才可声称送达；`failed` 不许说已送达。

---

## 11. 热停/热开

只改配置：

```json
"features": {"eventLog": false}
```

等待热加载，发一条本地消息：

```text
events N -> N（停住）
```

开回：

```text
events N -> N+2（恢复）
```

代码改动导致的热停不生效时：同步 dist + 重启。

---

## 12. 回滚

按风险从低到高：

```bash
git checkout -- <files>
# dist 备份
cp dist/whale-personal/<file>.bak-iXX dist/whale-personal/<file>
# 配置备份
cp data/config.json.bak-iXX data/config.json
```

回滚后：

1. 重跑本步测试；
2. 更新 evidence status=blocked；
3. 写 reason；
4. 不把回滚写成完成。

---

## 13. 故障 playbook

### 13.1 启动器后台 job 结束，鲸鲸也停了

原因：启动器是 job 子进程，被一起回收。

修：

```powershell
Start-Process -FilePath "D:\dsh\whale-personal\src\dist\whale-personal\WhaleLauncher.exe" `
  -ArgumentList "--autostart" `
  -WorkingDirectory "D:\dsh\whale-personal\src\dist\whale-personal"
```

然后 `healthz` 确认。

### 13.2 源码 `data/` 突然没了

启动器更新可能移到：

```text
D:\dsh\whale-personal\_local-data-backup
```

恢复：

```bash
mkdir -p data
cp -a /d/dsh/whale-personal/_local-data-backup/. data/
```

### 13.3 远端 main 分叉

启动器可能自动推 4.9.1 脚本。不要 force：

```bash
git fetch origin main
git merge origin/main
# 解冲突
git commit
git push origin release:release
git push origin release:main
```

### 13.4 真实发送 no_send_button

`--bg-send` 返回 false 就是没发出；不许算真实微信通过。改走 UIA 或人工确认。

### 13.5 workspace 越界

执行脑默认只到 `src/dist/whale-personal`；`src/tests` 会被拒绝。  
把测试文件放到允许工作区，或调整策略后再跑。

### 13.6 配置热加载 ≠ 代码热加载

`.js/.py` 改动必须同步 dist + 重启。

### 13.7 事件 id 双前缀

已修：现在 id = `chatId:entry.id`，例如 `wechat:u:xxx:msg_2`。

---

## 14. 发布

```bash
python skills/whale-mainline-integration/scripts/verify_all.py
python skills/whale-mainline-integration/scripts/integration_check.py --check
git status --short          # 只应有本次文件
git add ...
git commit -m "..."
git push origin release:release
git push origin release:main
git ls-remote origin refs/heads/main refs/heads/release
```

要求：

- `main` 和 `release` 同一 SHA；
- 不把 `data/`、dist、密钥提交；
- 分叉先 merge，不 force。

---

## 15. 完不成时怎么写

必须写：

```text
阻塞点：具体文件/权限/产品决策
已尝试：命令 + 结果
为什么不能绕过：风险
怎么完成：1/2/3 步
谁需要决定：owner / 产品 / 权限
```

禁止：

- 把 fake DSH 写成真实动作；
- 把 `local=true` 写成真实微信；
- 把有测试写成已上线；
- 把未接包写成 wired。

---

## 16. 完成定义

- 计划全 done；
- 每步 ≥5 案例、证据、测试、回滚；
- L3/L4/L5 至少各一次真实证据（按步骤要求）；
- 默认关时线上行为不变；
- 热停/热开可用；
- `verify_all.py` 全绿；
- `integration_check.py --check` 0；
- 文档/计划/状态/证据同步；
- 推送后 main/release 同提交。
