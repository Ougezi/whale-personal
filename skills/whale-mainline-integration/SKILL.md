---
name: whale-mainline-integration
description: 鲸鲸主链接入的执行 skill：把出生技能核心模块接进真实 kernel/bridge 主链，按 I-01..I-17 逐步过案例门禁、源码/测试/证据/回滚，再分 L0-L3 做构建产物、local dry-run、真实微信、真实 R2 动作与热停验收。Use when the owner says 主链接入 / 接入主链 / 下一步接入 / 热停 / 端到端验收 / 真实微信验收, or after 出生技能 26 步完成.
---

# whale-mainline-integration

这是**主链接入执行器**。出生技能负责“核心模块存在”，本 skill 负责“核心模块真的接进鲸鲸主链”，不允许把 core 模块当已上线。

## 固定路径

```
仓库：D:\dsh\whale-personal\src
计划：docs/personal/鲸鲸-主链接入-执行计划.json
目录：docs/personal/鲸鲸-主链接入-执行总目录.md
验收：docs/personal/鲸鲸-主链接入-验收.md
状态：data/integration/state.json
证据：data/integration/evidence/<step>.json
审计：data/integration/audit.jsonl
案例：docs/personal/鲸鲸-出生技能-案例库-313.json
运行产物：dist/whale-personal
```

## 命令

- `主链接入状态`：读 state/plan/evidence，报告 done/blocked/next。
- `主链接入下一步`：取第一个 pending/blocked step，先过案例门禁。
- `主链接入执行 <step>`：只执行指定步骤。
- `主链接入验收 <step>`：按 acceptance 逐条检查并写证据。
- `主链接入回滚 <step>`：恢复 `.bak-i*` 或 git checkout，标 blocked。
- `主链接入热停`：只改 `features.eventLog`，验证事件停写；不重启。
- `主链接入 E2E`：按 L0→L3 逐级，不允许跳级冒充。

## 强制门禁

### 1. 案例门禁

- 每步 `case_ids` ≥ `min_cases`（默认 5，计划预选 8）。
- case id 必须存在于 313 案例库。
- 证据写实际 case ids，不能写“参考了”。

### 2. 源码/现状门禁

- 接主链前先读真实调用点，不猜：
  - kernel：`src/app.js`、`src/pipeline/chat.js`、`src/memory/*`
  - bridge：`bridge/app.py`、`engine.py`、`sender_mixin.py`、`receiver_mixin.py`、`brain_agent.py`
- 外部源码才写 repo/commit/file/license；本地代码写调用点与行号。
- 只学模式，不整段抄。

### 3. 默认安全门禁

- 新能力默认关：feature 默认 false 或 env 开关。
- 失败必须 fail-open 到旧主链：
  - eventSink 失败只 warn；
  - prompt block 异常返回空；
  - guard 异常放行/不阻断旧链。
- R2/R3 未审批执行 0；越界路径 0；网络未允许 0。

### 4. 测试门禁

```bash
node scripts/personal/鲸鲸-内核自测.js          # 287/287
python scripts/personal/鲸鲸-自测.py            # 110/110（dist 环境）
python scripts/personal/鲸鲸-执行脑自测.py      # 41/41
python scripts/personal/鲸鲸-出生技能自测.py    # 26 步计划完整性
selfcheck                                      # 必须 true
```

接入步骤自己的测试必须全绿；测试失败先修或回滚，不跳。

### 5. 证据门禁

`data/integration/evidence/<step>.json`：

```json
{
  "version": 1,
  "step": "I-0X",
  "status": "done|blocked",
  "case_ids": ["...8..."],
  "source_reviews": [],
  "changes": ["..."],
  "tests": {"pass": 0, "fail": 0, "commands": ["..."]},
  "acceptance": [{"item":"...", "ok":true, "evidence":"..."}],
  "rollback": "...",
  "audit": [{"at":0,"step":"I-0X","action":"...","actor":"owner","risk":"R0","evidence":"..."}],
  "finishedAt": 0
}
```

没有证据 = 没完成。blocked 也必须写清 reason，不许空着。

### 6. 状态门禁

`data/integration/state.json`：

- 上一步 done 才下一步；
- 失败标 blocked，不跳；
- 全部 done 才 `"complete": true`。

### 7. 回滚门禁

- 源码：`git checkout -- <files>`；
- dist：改前留 `.bak-i*`，回滚恢复；
- 配置：`data/config.json.bak-i*`；
- 宪法/权限/审计/回滚机制不能回滚到更宽松版本。

## 执行循环

```
1. 读 plan/state/evidence
2. 选 pending/blocked step
3. CASE_GATE（≥5，存在于 313）
4. 读真实主链调用点
5. 默认关 + 旁路失败兜底，最小侵入实现
6. TEST_GATE（本步 + 回归）
7. 写 evidence / audit
8. 更新 state
9. 提交本步
10. 需要时同步 dist + 重启，做 L2/L3
```

## E2E 分级（不许跳级冒充）

| 级别 | 内容 | 能不能说“真实微信通过” |
|---|---|---|
| L0 | 源码单测 | 不能 |
| L1 | dist 构建产物 E2E | 不能 |
| L2 | 运行中 kernel local dry-run（`local=true`） | 不能 |
| L3 | 真实微信入站 + UIA 出站 | 可以，注明 submitted/未确认送达 |
| L4 | 真实 R2 动作 + 备份回滚 | 可以 |
| L5 | 热停/热开验证 | 可以 |

L2 只能写“真实内核 local dry-run”，不能写“真实微信收发”。

## 本仓库已验证的基线

- I-01 事件双写：8/8，kernel 287；
- I-02 working/session/instruction 接 prompt：8/8；
- I-03 发送口 SendGuard/回执：9/9，bridge 110；
- I-04 执行脑 ActionSpec 闸：10/10；
- I-05 真实微信 + 真实 R2 + 备份回滚：done；
- I-06 热停/热开：7/7，live 27→27 / 27→29；
- I-07 统一动作审计：brain + delegation 双写 action-audit；
- I-08 核心包接入矩阵：11 Node 包 + 12 桥接契约，wired 才允许说接入；
- I-09 源码-dist 同步检查：18 个关键文件 SHA256，漂移非 0；
- I-10 委托硬审批 + brain_policy 复用：9/9，未确认 run_task=0；
- I-11 审计事实源收敛：action-audit 唯一源，brain-audit 只投影；
- I-12 真实动作审计复测：真实 DSH 只读，delegation_done + brain done；
- I-13 retrieval core：features.retrievalCore 默认关，失败回退；
- I-14 去重/LRU/轮转：features 23 唯一，LRU 64，事件/回执 5MB；
- I-15 dist 全量/P3：287 文件/6 排除，0 漂移，26/26 重签；
- I-16 job.js：委托生命周期镜像，R2 未批不能 start；
- I-17 receipts.js：发送回执回传，pending→sent→delivered。

## 已知坑（都真实踩过）

1. **workspace 不是整个仓库**：执行脑默认只到 `src/dist/whale-personal`，给 `src/tests` 会被拒；先看 `_workspace_of`。
2. **`eventSink` 启动时注入**：只改 `features.eventLog` 旧代码不会停；I-06 已改为运行期 `enabled()`。
3. **`--bg-send` 可能 `no_send_button`**：没发出就是没发出，不许算真实微信通过。
4. **`local=true` 是 dry-run**：不会发微信，只能验 kernel。
5. **UIA `submitted` ≠ 确认送达**：证据要写清。
6. **配置热加载 ≠ 代码热加载**：`.js/.py` 改动必须同步 dist + 重启。
7. **launcher 不带 `--autostart` 只开 GUI**：要自动拉 kernel/bridge 必须带 `--autostart`。
8. **别把 `data/`、密钥、dist 提交**：dist 只是运行产物，源码才是提交对象。

## 状态检查

```bash
python skills/whale-mainline-integration/scripts/integration_check.py --check
```

退出码 0 = 计划/证据/状态一致；非 0 按输出修，不要继续。

## 完成定义

- 计划步骤全 done；
- 每步 ≥5 案例、证据、测试、回滚；
- L3/L4/L5 至少各一次真实证据（按本步要求）；
- 默认关时线上行为不变；
- 热停/热开可用；
- 文档、计划、状态、证据同步；
- 推送后 main/release 同一提交。
