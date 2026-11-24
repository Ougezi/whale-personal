# 鲸鲸 · DSH 执行脑：分阶段 Skill 计划（详细版）

> 状态：**已实现基础版（2026-11-24）**：P1/P2/P3/P4 定时只读已落地；多代理 Scout/Manager 暂不启用。
> 日期：2026-11-24
> 前序：[鲸鲸-DSH执行脑-方案.md](鲸鲸-DSH执行脑-方案.md)
> 样本：[鲸鲸-DSH执行脑-GitHub样本.json](鲸鲸-DSH执行脑-GitHub样本.json)

---

## 0. 这份计划解决什么

前一份方案回答了“要不要装、装成什么样”。这份回答：

1. **每个阶段分别查了哪些资料**（GitHub / B站 / 抖音）；
2. 每个阶段怎么落成**一个可执行的 skill**；
3. 每个 skill 的输入、步骤、产出、验收、失败回滚是什么；
4. 阶段之间怎么串起来，谁依赖谁。

每个阶段都能单独执行、单独验收、单独回滚；不要求一次做完。

---

## 1. 调研方法与资料地图

### 1.1 总量

| 来源 | 做法 | 结果 |
|---|---|---|
| GitHub | 8 组泛 Agent/微信/记忆查询 + 4 组分阶段查询 | 77 个候选，74 个保留，14 个精读 |
| B站 | 6 个视频/专栏（Claude Code、Agent 边界、LangGraph 断点、Agent Mesh、SubAgent） | 6 条可复用结论 |
| 抖音 | 4 条视频（TRAE 接手大项目、权限边界、Agent loop、SubAgent 隔离） | 4 条可复用结论 |

> 视频以搜索摘要/页面说明为主，没有逐帧看；GitHub 以 README/目录/描述为主。引用链接见 §11。

### 1.2 分阶段资料与结论

#### P1 只读执行脑

| 来源 | 资料 | 结论 |
|---|---|---|
| GitHub | [codenav-mcp](https://github.com/devchux/codenav-mcp) | 只读 MCP 给 Agent 结构化代码访问，是 P1 的理想形态 |
| GitHub | [RepoLens](https://github.com/Zhang-J1a/RepoLens) | 只读代码分析 + 版本化证据 + 引用，适合“先诊断后动手” |
| GitHub | [whale_girl](https://github.com/Banan1cee/whale_girl) | 鲸鲸现有分层：persona/memory/pipeline/bridge；P1 不碰记忆和写路径 |
| B站 | [Claude Code 两周体验](https://www.bilibili.com/opus/1203608213273968660) | 读项目、看文件、跑测试、分析报错、看 diff、整理提交信息；先读后写 |
| B站 | [Claude Code 0→1](https://www.bilibili.com/opus/1190772888236457991) | Agentic Coding 不等于聊天；有记忆/规划/工具；只读模式有价值 |
| 抖音 | [TRAE SOLO 接手百万行项目](https://www.douyin.com/shipin/7590575423277320198) | 先架构分析、模块划分、接口整理，再谈改动 |

**P1 核心结论**：只读阶段不是“能力缩水”，而是**先建立证据链**。先让 DSH 输出“项目地图 + 证据 + 建议”，鲸鲸转述，不写任何文件。

#### P2 可写 + 审批

| 来源 | 资料 | 结论 |
|---|---|---|
| GitHub | [humanlayer](https://github.com/humanlayer/humanlayer) | tasks/sessions/plans/reviews 集中管理，人可远程 steer |
| GitHub | [agents-from-scratch](https://github.com/langchain-ai/agents-from-scratch) | HITL：发送邮件/排会议等工具调用先给人审；Agent Inbox |
| GitHub | [Aegis](https://github.com/Justin0504/Aegis) | 运行时策略、加密审计、human-in-the-loop |
| GitHub | [cordum](https://github.com/cordum-io/cordum) | “动作防火墙”：高风险工具调用前强制策略/人工批准 |
| B站 | [AI Agent 不是聊天框](https://www.bilibili.com/video/BV1fE7w6SEjB/) | 任务边界、上下文、工具、权限、人工确认、评测、日志 |
| B站 | [真实 AI 智能体攻击](https://www.bilibili.com/video/BV14mno6FEHs/) | 最小权限、短期凭证、默认拒绝出站、高价值操作签核、熔断、审计 |
| 抖音 | [权限边界](https://www.douyin.com/shipin/7621738310079252514) | 只给工作目录，别用管理员；权限边界就是做事边界 |

**P2 核心结论**：写权限不是“打开一个开关”，而是**策略 + 审批 + 审计 + 回滚**四件套；宁可多问一次，不要默认放行。

#### P3 会话续跑

| 来源 | 资料 | 结论 |
|---|---|---|
| GitHub | [LangGraph](https://github.com/langchain-ai/langgraph) | checkpoints / threads / breakpoints：暂停等人、恢复继续 |
| GitHub | [agent-checkpoint](https://github.com/hotalexnet/agent-checkpoint) | repo-local checkpoint / handoff，Markdown 记录，跨会话续跑 |
| GitHub | [CLI-WeChat-Bridge](https://github.com/UNLINEARITY/CLI-WeChat-Bridge) | 微信是远程入口，本地会话为中心；L0–L3 渐进桥接 |
| GitHub | [AgentTeams](https://github.com/agentscope-ai/AgentTeams) | 任务状态历史、可审计、human visibility |
| B站 | [LangGraph 断点与检查点](https://www.bilibili.com/video/BV1CjptzREGu/) | 断点暂停等人工确认；checkpoint/thread 恢复 |
| 抖音 | [Agent loop 原理](https://www.douyin.com/shipin/7621737706011379753) | 未完成就把对话记录重新喂回，直到 finish；循环要有终止条件 |

**P3 核心结论**：续跑不是“再发一次”，而是**状态 + 事件游标 + 幂等键**；恢复前先对账工作区，避免重复副作用。

#### P4 主动/多代理

| 来源 | 资料 | 结论 |
|---|---|---|
| GitHub | [AgentTeams](https://github.com/agentscope-ai/AgentTeams) | Manager-Workers、共享文件、任务状态、可审计房间 |
| GitHub | [AutoGen](https://github.com/microsoft/autogen) | 多 Agent 对话/协作，人工可插入 |
| GitHub | [CrewAI](https://github.com/crewAIInc/crewAI) | 角色/任务编排，适合“研究-执行-审阅”分工 |
| B站 | [Agent Mesh](https://www.bilibili.com/opus/1132381983217811475) | 定时触发、任务分解、编排子任务 |
| 抖音 | [SubAgent 隔离](https://www.douyin.com/shipin/7642871630221346862) | 只读 subagent 先探索、写 note，主 agent 再读 note 改代码；避免污染主上下文 |

**P4 核心结论**：多代理先做“只读侦察 + 主代理执行”的两段式，不要一上来让多个 Agent 同时写；定时任务必须有配额、静默时段、审计。

---

## 2. 四个阶段共用的协议

四个阶段不是四套东西，而是同一套 Brain 协议的不同权限档位。

### 2.1 Task Envelope

```json
{
  "taskId": "task_YYYYMMDD_NNN",
  "chatId": "wechat:u:wxid_xxx",
  "goal": "一句话目标",
  "context": "主人原话摘要 + 约束",
  "workspace": "D:\\path",
  "permissions": {
    "read": true,
    "write": false,
    "shell": false,
    "network": false,
    "denyPaths": ["data", "backup"]
  },
  "deadlineSec": 900,
  "approval": { "mode": "read-only|ask-on-write|ask-on-risk", "channel": "wechat-master" },
  "memory": { "record": "task-card", "maxChars": 300 }
}
```

### 2.2 Event 协议

```json
{"type":"ack","taskId":"...","text":"收到，我先看看"}
{"type":"plan","taskId":"...","steps":["读日志","定位端口","给出建议"]}
{"type":"progress","taskId":"...","text":"已定位到 8787 被占用","percent":40}
{"type":"approval_request","taskId":"...","risk":"R2","question":"可以结束旧进程吗？","options":["可以","不要"]}
{"type":"need_input","taskId":"...","question":"要保留当前配置吗？"}
{"type":"result","taskId":"...","status":"done","summary":"...","evidence":["..."],"artifacts":[]}
{"type":"error","taskId":"...","message":"...","retryable":false}
```

### 2.3 状态机

```
created → running → waiting_approval → running → done
                    ↘ need_input ↗
                    ↘ failed / cancelled / timeout
```

### 2.4 风险分级（P2 起生效）

| 级别 | 例子 | 策略 |
|---|---|---|
| R0 | 读文件、看日志、搜索 | 自动 |
| R1 | 改自己仓库、生成临时文件 | 自动 + 记录 |
| R2 | 发消息、删文件、kill 进程、装包 | 必须主人审批 |
| R3 | 改系统、删 data、提权、外发隐私 | 审批 + 二次确认 |

### 2.5 记忆与人格边界

- 鲸鲸长期记忆只写 **任务卡**：目标、结果、证据、taskId、时间；
- 不把 DSH 的 trace/tool log 灌进鲸鲸 prompt；
- DSH 不演鲸鲸；鲸鲸负责最终口吻；
- 失败不说 traceback，说人话。

### 2.6 Skill 统一格式

每个阶段落成一个 `SKILL.md`，目录：

```
skills/whale-brain-p<X>-<name>/
  SKILL.md          # 触发、输入、步骤、验收
  references.md     # 本阶段资料和链接
  scripts/          # 可选：只读检查脚本
```

`SKILL.md` 的 frontmatter 至少：

```yaml
---
name: whale-brain-p1-readonly
description: Use when ...
---
```

下面四节就是四份可直接落的 skill 规格。

---

## 3. P1：`whale-brain-p1-readonly`（只读执行脑）

### 3.1 触发

主人说“查一下/看看/分析/为什么/怎么回事”，且：

- 消息里有路径、仓库、日志、报错、配置；
- 或明确要求“先别改，只告诉我原因”；
- 或任务需要读多个文件/跑只读命令。

不触发：纯闲聊、纯情绪、简单事实问答。

### 3.2 输入

```json
{
  "goal": "查 D:\\dsh\\whale-personal 为什么启动失败",
  "workspace": "D:\\dsh\\whale-personal",
  "constraints": ["不要动 data", "先只诊断"],
  "chatId": "wechat:u:wxid_xxx"
}
```

### 3.3 前置检查

1. `brain.enabled=true`，DSH 在线；
2. workspace 存在，且在允许根目录内；
3. 当前会话没有运行中的 P1 任务（有则复用/排队）；
4. 任务不含写动作；若含，降级为 P2 或先拒绝写。

### 3.4 执行步骤

| # | 动作 | 产出 | 检查 |
|---|---|---|---|
| 1 | 鲸鲸回执：“好，我先看看，不动文件” | ack | ≤3 秒 |
| 2 | Adapter 创建 DSH 会话，权限 `read-only`，deny `data/backup` | `taskId` / `sessionId` | 会话创建成功 |
| 3 | DSH 输出 3–5 步计划 | `plan` 事件 | 计划里没有写操作 |
| 4 | 读项目地图：`git status --short`、`git log -5`、目录/入口/脚本 | 证据 | 不改工作区 |
| 5 | 读日志/报错：定位文件、行号、时间 | 证据 | 引用具体路径 |
| 6 | 只读验证：`node --check`、`--dry-run`、只读 health（若会写则跳过） | 证据 | `git status` 不变 |
| 7 | 输出：根因 + 证据 + 建议（分“只读就能解决/需要 P2”） | `result` | 不含未验证断言 |
| 8 | 鲸鲸用自己的话转述，写任务卡 | 消息 + 记忆 | 不贴 traceback |

### 3.5 只读边界

允许：

- `git status/log/diff/show`、读文件、`rg`、`ls`、`cat`、`node --check`；
- 只读 MCP（代码检索、文件读取、日志读取）；
- 只读网页/搜索（如果开了网络）。

禁止：

- 写文件、删文件、改配置、kill 进程、安装包、`git commit/push`；
- 读 `data/`、`backup/`、密钥、聊天原文（除非任务明确且主人批准）；
- 把大段代码/日志原样发到微信（只发结论 + 证据摘要）。

### 3.6 验收

- 3 个真实只读任务完成；
- 每个任务 `git status` 前后一致；
- 没有 `data/` 写入；
- 首次回执 ≤3 秒；
- 结果包含“根因/证据/下一步”，不把 traceback 发到微信；
- 失败时鲸鲸仍能正常聊天。

### 3.7 失败/回滚

| 失败 | 处理 |
|---|---|
| DSH 不在线 | 回“执行脑没起来”，本地继续聊 |
| 30 秒无进度 | 回“在看了，稍等” |
| 3 分钟无事件 | 查询/催办 |
| 10 分钟无事件 | 取消，告知 |
| 越界读 | 拒绝并记审计 |

回滚：`brain.p1.enabled=false`，不删任何数据。

### 3.8 参考

- [codenav-mcp](https://github.com/devchux/codenav-mcp)
- [RepoLens](https://github.com/Zhang-J1a/RepoLens)
- [Claude Code 两周体验](https://www.bilibili.com/opus/1203608213273968660)
- [TRAE SOLO 接手大项目](https://www.douyin.com/shipin/7590575423277320198)

---

## 4. P2：`whale-brain-p2-write-approval`（可写 + 审批）

### 4.1 触发

P1 结论是“需要改代码/改配置/跑有副作用命令”，或主人明确说“修好/改一下/重启/删掉”。

### 4.2 输入

```json
{
  "goal": "修复启动失败",
  "workspace": "D:\\dsh\\whale-personal",
  "allowWrite": true,
  "denyPaths": ["data", "backup"],
  "riskPolicy": "ask-on-write",
  "approvalChannel": "wechat-master"
}
```

### 4.3 前置检查

1. P1 已完成，根因/改动点明确；
2. 工作区干净或已备份；
3. 写路径在 allowlist；
4. 当前没有同会话写任务；
5. 主人身份有效。

### 4.4 执行步骤

| # | 动作 | 产出 | 检查 |
|---|---|---|---|
| 1 | 先复述改动计划：改哪些文件、为什么、怎么验证 | `plan` | 主人能看懂 |
| 2 | 风险分级：R0/R1 直接做；R2/R3 发审批 | `approval_request` | 审批只发主人 |
| 3 | 等审批（超时 5 分钟默认拒绝） | 批准/拒绝 | 非主人批准无效 |
| 4 | 备份/快照（文件级或临时目录） | 备份路径 | 可回滚 |
| 5 | 应用最小改动 | diff | 不越界 |
| 6 | 跑验证：语法、单测、health、自检 | 证据 | 失败即停 |
| 7 | 失败：回滚到备份，报告“哪一步失败” | 回滚结果 | 不留半改状态 |
| 8 | 成功：输出 diff 摘要 + 验证证据 | `result` | 不贴全量日志 |
| 9 | 鲸鲸转述；写任务卡 | 消息 + 记忆 | 不含密钥 |

### 4.5 审批卡格式

```
【需要你确认】
任务：修复启动失败
动作：结束占用 8787 的旧进程，然后重启
风险：R2（有副作用，可恢复）
回复「可以」执行；「不要」取消。
5 分钟不回复默认取消。
```

### 4.6 写边界

- 只写 allowlist 内路径；
- 默认 deny `data/`、`backup/`、`.git/` 的写（读可以）；
- 不自动 `git push`、不自动发微信、不自动改系统设置；
- R3 必须二次确认；
- 所有写操作记审计（谁批的、改了什么、验证结果）。

### 4.7 验收

- 改一个 scratch 文件 → 验证 → 回滚，全链路通过；
- 越界路径被拒；
- 非主人审批被拒；
- 审批超时被拒；
- 测试失败自动回滚；
- 审计可查。

### 4.8 失败/回滚

| 失败 | 处理 |
|---|---|
| 审批拒绝/超时 | 不写，回“那先不动” |
| 写入失败 | 关坏句柄/还原备份（参考鲸鲸写失败恢复） |
| 测试失败 | 回滚 + 报告失败点 |
| 改错文件 | git diff + 备份还原 |
| DSH 崩溃 | 标记 interrupted，工作区对账 |

回滚：`brain.p2.enabled=false`；已有备份保留 7 天。

### 4.9 参考

- [humanlayer](https://github.com/humanlayer/humanlayer)
- [agents-from-scratch HITL](https://github.com/langchain-ai/agents-from-scratch)
- [Aegis](https://github.com/Justin0504/Aegis)
- [cordum](https://github.com/cordum-io/cordum)
- [AI Agent 不是聊天框](https://www.bilibili.com/video/BV1fE7w6SEjB/)
- [真实 AI 智能体攻击](https://www.bilibili.com/video/BV14mno6FEHs/)
- [权限边界](https://www.douyin.com/shipin/7621738310079252514)

---

## 5. P3：`whale-brain-p3-resume`（会话续跑）

### 5.1 触发

- 任务运行超过 2 分钟；
- 桥接/内核/DSH 重启；
- 主人问“弄到哪了”；
- 审批后继续；
- 任务失败但可重试。

### 5.2 输入

```json
{
  "taskId": "task_...",
  "dshSessionId": "...",
  "eventCursor": 12,
  "workspace": "D:\\...",
  "checkpoint": "brain-sessions/<taskId>.json"
}
```

### 5.3 状态文件

`data/brain-sessions.json`（或 `.brain/sessions/`）：

```json
{
  "taskId": "task_...",
  "chatId": "wechat:u:...",
  "dshSessionId": "...",
  "status": "running|waiting_approval|done|failed|interrupted",
  "eventCursor": 12,
  "lastEventAt": 1795500000000,
  "workspace": "D:\\...",
  "approval": { "risk": "R2", "question": "...", "askedAt": 0 },
  "result": null
}
```

### 5.4 执行步骤

| # | 动作 | 产出 | 检查 |
|---|---|---|---|
| 1 | 创建任务时落状态文件 | session 记录 | 原子写 |
| 2 | 每收到一个事件，更新 `eventCursor` | 游标 | 不重复处理 |
| 3 | 每个工具调用后写 checkpoint（步骤/已改文件/待验证） | checkpoint | 可读 |
| 4 | 进程重启：加载状态，校验 workspace 是否变过 | 对账结果 | 不盲目续 |
| 5 | 向 DSH resume；失败则询问“继续/放弃” | `resume`/`ask` | 不重复副作用 |
| 6 | 审批等待：记录 `askedAt`，超时拒绝 | 状态 | 不悬挂 |
| 7 | 主人问进度：读状态 + 最近事件，1 句话回答 | 消息 | 不编 |
| 8 | 取消：发 cancel，标记 cancelled，保留现场 | 状态 | 不再发结果 |

### 5.5 幂等键

- `taskId + stepId`：同一步只执行一次；
- `approvalId`：同一审批只处理一次；
- `eventCursor`：只处理新事件；
- 写操作前记录“已执行”标记，恢复时先查。

### 5.6 验收

- 任务进行到一半 kill Adapter，重启后能 resume 或明确 interrupted；
- 不重复写文件/发消息；
- 审批等待能跨重启保留；
- 主人问进度能答“做到哪、卡在哪”；
- 取消失效。

### 5.7 失败/回滚

| 失败 | 处理 |
|---|---|
| DSH 会话不存在 | 标记 interrupted，工作区对账，给“继续/放弃” |
| workspace 变了 | 先 diff/对账，不自动续 |
| checkpoint 损坏 | 回到上一个 checkpoint |
| 重复事件 | 用 cursor 去重 |
| 审批丢失 | 重新询问，不默认放行 |

回滚：删状态文件只影响续跑，不删工作区。

### 5.8 参考

- [LangGraph](https://github.com/langchain-ai/langgraph)
- [agent-checkpoint](https://github.com/hotalexnet/agent-checkpoint)
- [CLI-WeChat-Bridge](https://github.com/UNLINEARITY/CLI-WeChat-Bridge)
- [AgentTeams](https://github.com/agentscope-ai/AgentTeams)
- [LangGraph 断点与检查点](https://www.bilibili.com/video/BV1CjptzREGu/)
- [Agent loop 原理](https://www.douyin.com/shipin/7621737706011379753)

---

## 6. P4：`whale-brain-p4-proactive`（主动/多代理）

### 6.1 触发

- 主人设置“每天早上 9 点汇总”；
- 长任务完成后主动汇报；
- 需要“侦察 + 执行”两段式；
- 主人明确说“你自己安排/盯一下”。

### 6.2 输入

```json
{
  "schedule": "RRULE:FREQ=DAILY;BYHOUR=9;BYMINUTE=0",
  "goal": "汇总昨天项目状态",
  "workers": 2,
  "quietHours": ["23:00", "08:00"],
  "budget": { "maxRunsPerDay": 2, "maxSeconds": 600 },
  "approval": "ask-on-risk"
}
```

### 6.3 执行步骤

| # | 动作 | 产出 | 检查 |
|---|---|---|---|
| 1 | 注册定时任务（本地持久化） | schedule | 幂等，不重复注册 |
| 2 | 到点检查静默时段/配额/已有任务 | 准入 | 不打扰 |
| 3 | 开 Manager 会话；先派只读 Scout（≤2 个） | notes | Scout 只读 |
| 4 | Scout 输出“发现 + 路径 + 证据”到共享 note | note | 不改代码 |
| 5 | Manager 读 note，决定是否执行；写操作走 P2 审批 | plan | 不越权 |
| 6 | 汇总结果，按鲸鲸口吻发微信 | 消息 | 不刷屏 |
| 7 | 写任务卡 + 审计 | 记录 | 可回查 |
| 8 | 失败：标记 failed，下一轮不重复 | 状态 | 配额扣减 |

### 6.4 多代理边界

- 只有 Manager 能写；Scout 只读；
- Scout 的 note 是唯一交接物，不把 Scout 的全文塞进 Manager 上下文；
- 最多 2 个 Scout，避免成本爆炸；
- 定时任务默认不执行 R2/R3，除非主人在场批准。

### 6.5 验收

- 每日 9 点汇总，连续 3 天不重复；
- 静默时段不触发；
- 配额生效；
- 2 个 Scout 的 note 能被 Manager 正确使用；
- 预算/审计可查；
- 任何写操作仍需审批。

### 6.6 失败/回滚

| 失败 | 处理 |
|---|---|
| 定时任务重复 | 用 `scheduleId` 幂等 |
| 配额超 | 跳过并记录 |
| Scout 卡住 | 取消，Manager 继续或降级 |
| 成本超 | 熔断，下一轮降级为单 Scout |
| 主人关闭 | `brain.p4.enabled=false`，保留历史 |

### 6.7 参考

- [AgentTeams](https://github.com/agentscope-ai/AgentTeams)
- [AutoGen](https://github.com/microsoft/autogen)
- [CrewAI](https://github.com/crewAIInc/crewAI)
- [Agent Mesh](https://www.bilibili.com/opus/1132381983217811475)
- [SubAgent 隔离](https://www.douyin.com/shipin/7642871630221346862)

---

## 7. 阶段依赖与里程碑

```
P1 只读
  └─ P2 可写+审批
        └─ P3 续跑
              └─ P4 主动/多代理（可选）
```

| 里程碑 | 内容 | 验收 |
|---|---|---|
| M1 | P1 上线，只读任务可用 | 3 个真实任务，无写入 |
| M2 | P2 上线，写操作有审批 | scratch 改动/回滚/越界拒绝 |
| M3 | P3 上线，重启可续 | kill 后恢复，无重复副作用 |
| M4 | P4 可选，定时/多代理 | 3 天定时，无重复/超预算 |

每个阶段独立 feature flag：

```
brain.p1.enabled
brain.p2.enabled
brain.p3.enabled
brain.p4.enabled
```

---

## 8. 跨阶段测试矩阵

| 用例 | P1 | P2 | P3 | P4 |
|---|---|---|---|---|
| 只读诊断 | ✅ | ✅ | ✅ | ✅ |
| 越界路径 | 拒绝 | 拒绝 | 拒绝 | 拒绝 |
| 非主人审批 | — | 拒绝 | 拒绝 | 拒绝 |
| 审批超时 | — | 拒绝 | 拒绝 | 拒绝 |
| 写失败回滚 | — | ✅ | ✅ | ✅ |
| 进程重启 | — | — | ✅ | ✅ |
| 重复消息 | ✅ | ✅ | ✅ | ✅ |
| DSH 离线 | 兜底 | 兜底 | 兜底 | 兜底 |
| 成本上限 | — | — | — | ✅ |

---

## 9. 观测指标

| 指标 | P1 | P2 | P3 | P4 |
|---|---|---|---|---|
| 首次回执 | ≤3s | ≤3s | ≤3s | ≤3s |
| 任务成功率 | ≥85% | ≥80% | ≥90% 恢复 | ≥85% |
| 审批到达 | — | ≤5s | ≤5s | ≤5s |
| 卡住率 | <5% | <5% | <3% | <5% |
| 重复副作用 | 0 | 0 | 0 | 0 |
| 记忆污染 | 0 | 0 | 0 | 0 |

---

## 10. 风险与回滚

| 风险 | 缓解 |
|---|---|
| 只读阶段被当成“万能” | 明确“只诊断，不动手” |
| 审批疲劳 | 只对 R2/R3 问；R1 记录 |
| 续跑重复写 | 幂等键 + 工作区对账 |
| 多代理成本 | Scout ≤2、预算、熔断 |
| 人格漂移 | DSH 不演鲸鲸，最终重写 |
| 权限扩大 | 最小权限、白名单、审计 |
| 记忆污染 | 只记任务卡 |
| 微信封控 | 保持现有节奏，不加速 |

一键回滚：对应阶段 `enabled=false`；不删任务卡/会话记录。

---

## 11. 待确认决策

| 决策 | 默认建议 | 说明 |
|---|---|---|
| Adapter 放哪 | 鲸鲸 kernel | 离路由/记忆近 |
| 通信 | 本机 HTTP + SSE | 简单可观测 |
| P1 是否联网 | 先不联网 | 降风险 |
| 审批超时 | 5 分钟拒绝 | 安全优先 |
| 并发 | 每会话 1 / 全局 2 | 防打爆 |
| 任务保留 | 7 天 | 可回查 |
| P4 是否首期做 | 不做 | 先稳 P1–P3 |
| 是否允许 DSH 装包 | 需 R2 审批 | 防供应链 |

---

## 12. 参考链接汇总

### GitHub

- https://github.com/Banan1cee/whale_girl
- https://github.com/UNLINEARITY/CLI-WeChat-Bridge
- https://github.com/humanlayer/humanlayer
- https://github.com/langchain-ai/agents-from-scratch
- https://github.com/langchain-ai/langgraph
- https://github.com/tigerless-labs/agent-memory
- https://github.com/oceanbase/powercontext
- https://github.com/agentscope-ai/AgentTeams
- https://github.com/microsoft/autogen
- https://github.com/crewAIInc/crewAI
- https://github.com/All-Hands-AI/OpenHands
- https://github.com/simular-ai/Agent-S
- https://github.com/devchux/codenav-mcp
- https://github.com/Zhang-J1a/RepoLens
- https://github.com/Justin0504/Aegis
- https://github.com/cordum-io/cordum
- https://github.com/hotalexnet/agent-checkpoint

### B站

- https://www.bilibili.com/opus/1203608213273968660
- https://www.bilibili.com/opus/1190772888236457991
- https://www.bilibili.com/video/BV1fE7w6SEjB/
- https://www.bilibili.com/video/BV14mno6FEHs/
- https://www.bilibili.com/video/BV1CjptzREGu/
- https://www.bilibili.com/opus/1132381983217811475

### 抖音

- https://www.douyin.com/shipin/7590575423277320198
- https://www.douyin.com/shipin/7621738310079252514
- https://www.douyin.com/shipin/7621737706011379753
- https://www.douyin.com/shipin/7642871630221346862

### 本地样本

- [GitHub 样本 JSON](鲸鲸-DSH执行脑-GitHub样本.json)

---

## 13. 结论

四个阶段分别落成四个 skill：

1. `whale-brain-p1-readonly`：只诊断，不动手；
2. `whale-brain-p2-write-approval`：能改，但先审批；
3. `whale-brain-p3-resume`：能续，但不重复；
4. `whale-brain-p4-proactive`：能主动，但有配额和边界。

先做 P1，验收通过再做 P2；P3 解决“长任务/重启”，P4 最后。每个阶段都有独立开关、独立验收、独立回滚。

**本轮仍然没有改代码、没有安装新 skill，只补了调研和计划书。**

---

## 14. 执行记录（2026-11-24）

实现提交：`a64f300`（已推送 main/release）

- P1 只读：真实读 `D:\dsh\brain-test\test.txt` 返回 42，未写文件。
- P2 审批：`脑子写` 先 pending_approval；主人回「可以」后 workspace-write 创建 `ok.txt`，内容 hello。
- P3 续跑：同一个 `session-id` 续问，返回上一轮结果；会话一致。
- P4 定时：`脑子定时：每天 HH:MM ...` 解析/静默 23–08/配额已实现；`脑子深查` 两路只读 Scout + Manager 汇总已实测。
- 技能：`whale-brain-p1-readonly`、`p2-write-approval`、`p3-resume`、`p4-proactive` 已安装到 `D:\dsh\skills`。
- 测试：内核 287/287、桥接 108/108、health/selfcheck 通过。

已知边界：P1 的“不联网”是提示词约束，不是硬网络隔离；P2 已加 workspace 白名单（默认 `D:\dsh`，拒绝 data/backup）；多代理写未启用。
