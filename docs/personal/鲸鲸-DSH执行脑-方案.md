# 鲸鲸 · 把 DSH 装成“执行脑” — 调研与计划书

> 状态：设计稿（**只做调研和计划，不改代码**）
> 日期：2026-11-24
> 关联：`docs/personal/鲸鲸-漏回补答-方案.md`、现有 `whale-delegation`（一次性委托）
> 样本：GitHub 搜索 8 组查询，77 个候选，保留 74 个，精读 14 个，引用 25 个（见附录 JSON）

---

## 0. 一句话结论

可以装，但装法不是“把 DSH 塞进鲸鲸”，而是：

> **鲸鲸保留人设、长期记忆、微信手脚；把“会规划、会调工具、会自检、会返工”的执行脑交给一个持续在线的 DSH 会话。**

这相当于把现在的“一次性委托执行端”升级成：

```
微信 ←→ 鲸鲸（人设/记忆/路由/说话）
              │
              └── Brain Adapter（新神经）
                        │
                        └── DSH Session（规划/工具/MCP/技能/审批/恢复）
```

本文只定架构、协议、边界、阶段和测试，不写实现代码。

---

## 1. 调研方法与样本

### 1.1 搜索范围

在 GitHub 用 8 组关键词各取前 10（按 star 排序），去重后 77 个：

| 组 | 关键词 | 关注点 |
|---|---|---|
| 1 | `wechat llm bot` | 微信/IM 接入 |
| 2 | `wechat agent bot` | 微信 Agent 化 |
| 3 | `ai companion memory` | 人设、陪伴、记忆 |
| 4 | `long-term memory agent` | 长期记忆 |
| 5 | `human-in-the-loop agent` | 审批/人机协同 |
| 6 | `computer use agent` | 操作电脑 |
| 7 | `mcp agent framework` | 工具/MCP |
| 8 | `personal assistant llm agent` | 个人助理 |

### 1.2 筛选标准

保留：

- 有明确“IM/微信 ↔ Agent”桥接，或
- 有可借鉴的长期记忆/人设分离，或
- 有审批、会话恢复、多代理审计，或
- 有电脑操作/沙箱的工程实践。

剔除：纯营销页、与主题无关的政治/社区仓库、只有 README 没有实现的空壳。

### 1.3 精读样本（14 个）

| 仓库 | Star | 为什么读 |
|---|---:|---|
| `Banan1cee/whale_girl` | 963 | 鲸鲸上游本体，确认现有分层和“一次性委托”的边界 |
| `UNLINEARITY/CLI-WeChat-Bridge` | 579 | 微信作为本地 CLI 会话的远程入口，L0–L3 渐进桥接 |
| `humanlayer/humanlayer` | 12,939 | 会话、计划、评审、远程 steer |
| `a16z-infra/companion-app` | 5,987 | 人设 preamble、seed chat、embedding 记忆 |
| `tigerless-labs/agent-memory` | 4,319 | Markdown 为真源、MEMORY.md 注入、BM25+向量、睡眠整理 |
| `oceanbase/powercontext` | 1,805 | 跨 Agent 的记忆交接 |
| `langchain-ai/agents-from-scratch` | 2,463 | HITL 审批工具调用 + memory notebook |
| `agentscope-ai/AgentTeams` | 6,126 | Manager-Workers、可审计房间、任务状态历史 |
| `the-open-agent/openagent` | 5,754 | 个人助理 Agent loop |
| `simular-ai/Agent-S` | 13,033 | 电脑操作 Agent 的能力与风险 |
| `felinics/Memoh` | 2,824 | 每个 Agent 有自己的电脑/网络 |
| `Project-N-E-K-O/N.E.K.O` | 3,282 | 陪伴 Agent 的实时语音/视觉 |
| `morettt/my-neuro` | 1,464 | 桌面陪伴角色的形态 |
| `open-gitagent/gitagent` | 754 | 身份/状态放进 git 仓库，可版本化 |

### 1.4 同族参考（未精读，但作为对照）

- `wangrongding/wechat-bot`（11,566）：多平台 IM 适配
- `yincongcyincong/MuseBot`（1,815）：Telegram/Discord/微信等多平台 Agent
- `lawrencewzen/wx-bot`（245）：微信接个人 Agent
- `corespeed-io/wechatbot`（706）：iLink Bot SDK
- `sunnoy/openclaw-plugin-wecom`（701）：企业微信插件
- `pinganbbOvO/ai-companion-kit`（574）：QQ 陪聊 + MCP 控制手机
- `All-Hands-AI/OpenHands`、`langchain-ai/langgraph`、`mem0ai/mem0`、`letta-ai/letta`、`modelcontextprotocol/servers`
- 完整 74 条见 [鲸鲸-DSH执行脑-GitHub样本.json](鲸鲸-DSH执行脑-GitHub样本.json)

---

## 2. 从例子里提炼出的 9 个模式

### 模式 1：IM 是远程入口，不是新工作台

`CLI-WeChat-Bridge` 的定位写得很清楚：

- 本地 CLI 仍是主工作界面，微信是远程入口；
- 会话一致性、线程状态、审批流以本地会话为中心；
- 支持 L0 单桥接 → L1 多 CLI → L2 多实例 → L3 多目录的渐进扩展。

对鲸鲸的启示：**不要把 DSH 的 UI/工作台搬进微信**；微信只做“入口 + 结果 + 审批”，执行现场留在 DSH 会话。

### 模式 2：会话要能“续”，不是一次性 subprocess

`humanlayer` 把 agent 的 tasks / sessions / plans / reviews 放在一个地方同步；`CLI-WeChat-Bridge` 强调保留原生本地会话；`AgentTeams` 有任务状态历史。

对鲸鲸的启示：当前委托是“派一次活、等结果”。要装脑子，必须有：

- `chatId + taskId -> dshSessionId` 映射；
- 会话可 resume / cancel / 查询进度；
- 进程重启后能恢复“上次做到哪”。

### 模式 3：审批是一等公民

`agents-from-scratch` 专门用 HITL notebook 演示“发送邮件/排会议”这类工具调用先给人看；`humanlayer` 的 review/steer 也是围绕审批。

对鲸鲸的启示：

- 读操作可以自动；
- 写文件、发消息、删东西、跑命令必须有风险分级；
- 审批要在微信里能完成，且只有主人能批；
- 审批超时要拒绝，不能默认放行。

### 模式 4：人设和脑子分离

`companion-app` 用 character README + seed chat + embedding；鲸鲸上游本身也把 persona / memory / pipeline 分层。

对鲸鲸的启示：

- DSH 不需要“演鲸鲸”，它只负责“把事做成”；
- 鲸鲸负责“用鲸鲸的口吻说结果”；
- 不把 DSH 的执行日志直接灌进人设 prompt。

### 模式 5：记忆用“文件为真源 + 检索缓存”

`agent-memory` 的做法很值得抄：

- `MEMORY.md` 是唯一常驻注入；
- 一条记忆一个文件，`valid_from/invalid_at` 管有效期；
- 三路检索：MEMORY.md / BM25 / 向量，miss 一路还有别的；
- 写入覆盖是系统责任，不是 Agent 自觉；
- 睡眠整理只允许 add/update，删除只能提案，用户确认；
- 全量 trace 先复制，摘要失败不等于丢知识。

对鲸鲸的启示：

- 鲸鲸现有 `chats/summary/people/events` 已经接近这个方向；
- DSH 任务的“过程”不要塞进鲸鲸长期记忆，只留**结果 + 证据 + 任务 id**；
- 需要时再通过 taskId 回查 DSH 会话。

### 模式 6：记忆交接要显式

`powercontext` 主打 long-term memory + memory handoff。鲸鲸和 DSH 是两套上下文，必须有“交接单”，不能靠模型自己猜。

### 模式 7：Manager-Workers + 可审计

`AgentTeams` 用 Manager 管多个 Worker，有共享文件系统、任务状态历史、可审计房间。

对鲸鲸的启示：Phase 1 先单会话；Phase 3 再考虑“鲸鲸派多个 DSH 子任务”，但每个子任务都要有 owner、状态、证据。

### 模式 8：电脑操作 = 能力 + 风险

`Agent-S`、`OpenHands`、`Memoh` 都说明：给 Agent 一台电脑/一个工作区，能力很强，但必须有沙箱、权限、超时、审计。鲸鲸是跑在主人真实电脑上的，风险更高。

### 模式 9：多平台适配是外壳，不是脑子

`wechat-bot`、`MuseBot`、`wx-bot` 的价值在“多平台接入 + 会话路由”，不在执行脑。鲸鲸不需要重写这些，只需要把 DSH 接进现有微信桥。

---

## 3. 鲸鲸现状与差距

### 已有

- 微信收发、UIA、媒体、表情包、语音、主动关心
- 人设 / 记忆（messages、summary、people、events）/ 睡眠整理
- 一次性委托：`whale-delegation`，派给执行端，等结果
- 记忆审计、写失败计数、health/selfcheck
- 桥接 token、本机限制、主人身份判定

### 差距

| 差距 | 现状 | 目标 |
|---|---|---|
| 会话 | 一次性任务 | 可持续 DSH 会话 |
| 进度 | 只有开始/结束 | 进度、卡住、需要确认 |
| 审批 | 基本没有 | 风险分级 + 微信审批 |
| 恢复 | 失败重派 | 断点续、取消、超时 |
| 记忆 | 结果靠文本 | 结构化结果 + taskId 回查 |
| 安全 | 工作区/权限粗 | 白名单 + 审批 + 审计 |
| 人格 | 委托结果直接说 | 鲸鲸重新组织语言 |

---

## 4. 推荐架构：外挂执行脑

```
┌──────────────────────────────┐
│ 微信 / 主人                    │
└──────────────┬───────────────┘
               │ 文本/语音/图片
┌──────────────▼───────────────┐
│ 鲸鲸 kernel                   │
│  persona / memory / router    │
│  - 闲聊：本地 pipeline         │
│  - 任务：创建 Task Envelope    │
└──────────────┬───────────────┘
               │ Brain Adapter（HTTP/WS，本机）
┌──────────────▼───────────────┐
│ DSH Session                   │
│  planner / tools / MCP /      │
│  skills / subagents / approval│
│  workspace / sandbox          │
└──────────────┬───────────────┘
               │ events: progress/approval/result
┌──────────────▼───────────────┐
│ 鲸鲸：转述、审批、记忆、兜底    │
└──────────────────────────────┘
```

### 4.1 关键原则

1. **鲸鲸是“嘴巴 + 记忆 + 人格”，DSH 是“手 + 脑子”。**
2. **一个任务一个 DSH 会话**；同一会话可多轮追问。
3. **任务过程不进入鲸鲸 prompt**；只进“任务结果卡”。
4. **所有有副作用的动作先审批**；审批只认主人。
5. **DSH 挂了，鲸鲸必须还能聊天**。

---

## 5. Task Envelope（任务交接单）

鲸鲸创建任务时，给 DSH 一个结构化信封，而不是把聊天记录整段丢过去：

```json
{
  "taskId": "task_20261124_001",
  "chatId": "wechat:u:wxid_xxx",
  "goal": "查一下 D:\\dsh\\whale-personal 为什么启动失败，修好并验证",
  "context": "主人刚说启动失败；不要动 data；改完告诉我证据",
  "workspace": "D:\\dsh\\whale-personal",
  "permissions": {
    "read": true,
    "write": true,
    "shell": true,
    "network": true,
    "denyPaths": ["data", "backup"]
  },
  "persona": {
    "speaker": "鲸鲸",
    "tone": "自然、简短、不要助手腔",
    "finalFormat": "1-3 句结论 + 关键证据"
  },
  "deadlineSec": 1800,
  "approval": {
    "mode": "ask-on-write",
    "channel": "wechat-master"
  }
}
```

DSH 返回的事件统一为：

```json
{"type":"progress","taskId":"...","text":"已定位到 8787 被旧进程占用","percent":40}
{"type":"approval_request","taskId":"...","risk":"kill-process","question":"可以结束旧进程吗？","options":["可以","不要"]}
{"type":"need_input","taskId":"...","question":"要保留当前配置吗？"}
{"type":"result","taskId":"...","status":"done","summary":"...","evidence":["health 通过","287/287"],"artifacts":[]}
{"type":"error","taskId":"...","message":"...","retryable":false}
```

---

## 6. 路由：什么交给 DSH

| 消息类型 | 走哪 | 例子 |
|---|---|---|
| 闲聊/情绪/记忆 | 鲸鲸本地 | “今天好累”“你还记得…” |
| 简单查询 | 鲸鲸本地/轻工具 | 天气、时间、算数 |
| 需要多步/工具/文件/电脑 | DSH | “查项目为什么挂”“整理这批文件” |
| 需要审批的副作用 | DSH + 审批 | “删掉旧日志”“发邮件” |
| 定时/长任务 | DSH 会话 | “每天 9 点汇总” |

路由判断不能只靠关键词；建议：

- 规则先判（有路径、有“帮我改/查/装/跑”、有附件、明确多步）；
- 不确定时用一个小分类器（本地/DSH）；
- 默认偏向本地，避免每句话都开 Agent。

---

## 7. 会话、并发与恢复

### 7.1 会话映射

```
data/brain-sessions.json
{
  "chatId": {
    "taskId": "task_...",
    "dshSessionId": "...",
    "status": "running|waiting_approval|done|failed|cancelled",
    "lastEventAt": 1795500000000,
    "workspace": "...",
    "summary": "..."
  }
}
```

### 7.2 并发

- 每个微信会话同时最多 1 个 DSH 任务；
- 全局最多 2 个（可配置）；
- 超出的排队，先回“排队中，前面还有 1 个”；
- 同一任务内可继续追问，不新建会话。

### 7.3 生命周期

```
created → running → (waiting_approval) → done
                    ↘ need_input ↗
                    ↘ failed / cancelled / timeout
```

- 空闲 30 分钟：会话挂起，不杀；
- 任务超过 deadline：取消并告知；
- 进程重启：按 taskId 尝试 resume；失败则标记 interrupted，下次主人问起再说明。

---

## 8. 审批与安全

### 8.1 风险分级

| 级别 | 例子 | 策略 |
|---|---|---|
| R0 只读 | 读文件、查日志、搜索 | 自动 |
| R1 可逆写 | 改自己仓库、生成文件 | 默认自动，记录 |
| R2 有副作用 | 发消息、删文件、kill 进程、装软件 | **必须审批** |
| R3 危险 | 改系统、删 data、提权、外发隐私 | **必须审批 + 二次确认** |

### 8.2 审批通道

- 只推给主人私聊；
- 审批卡：`taskId + 风险 + 一句话 + 选项`；
- 主人回“可以/不要/改一下”；
- 超时 5 分钟默认拒绝；
- 非主人发“可以”无效；
- 审批记录写审计。

### 8.3 安全边界

- 工作区白名单；默认不允许碰 `data/`、`backup/`、系统目录；
- 网络默认开，但外发内容要脱敏；
- 不把微信 token、API key、聊天原文发给 DSH 之外的服务；
- DSH 工具权限按任务最小化；
- 所有任务有审计：谁发起、什么权限、批了什么、做了什么。

---

## 9. 记忆边界与人格

### 9.1 鲸鲸记什么

只记“任务卡”：

```json
{
  "taskId": "task_...",
  "goal": "修启动失败",
  "result": "旧进程占用 8787，已结束并重启，health 通过",
  "evidence": ["health", "287/287"],
  "at": 1795500000000,
  "dshSessionId": "..."
}
```

不记 DSH 的完整思考/工具日志；需要细节时按 `dshSessionId` 回查。

### 9.2 人格怎么说

- DSH 的 `result.summary` 是“事实”，不是“鲸鲸的话”；
- 鲸鲸用自己的人设/关系/情绪重写；
- 不照念工具名、日志、JSON；
- 失败时说人话：“这边卡住了，我先陪你聊，晚点再试”，不把 traceback 发出去。

### 9.3 防人格漂移

- 鲸鲸 system prompt 不包含 DSH 的工具说明；
- DSH prompt 不包含鲸鲸的亲密关系设定（避免它演）；
- 只交接“目标/约束/结果”，不交接“人格”。

---

## 10. 可靠性与兜底

| 场景 | 处理 |
|---|---|
| DSH 启动失败 | 回“执行脑没起来”，本地继续聊天 |
| 30 秒无进度 | 回“在弄了，稍等” |
| 3 分钟无事件 | 查询/催办；仍无则标记卡住 |
| 10 分钟无事件 | 取消，告知，保留现场 |
| 审批超时 | 默认拒绝，任务暂停 |
| 发送失败 | 重试 1 次；仍失败入待发队列 |
| 进程重启 | 尝试 resume；失败标记 interrupted |
| 重复消息 | taskId 幂等；同一消息不重复开任务 |
| 用户中途改需求 | 向 DSH 发 follow-up，不新开任务 |

---

## 11. 分阶段计划

### P0 调研与计划（本轮）

- [x] GitHub 样本 74 个，精读 14 个
- [x] 本计划书
- [x] 不改代码

### P1 只读执行脑（建议 1–2 天）

- 任务信封、会话映射、事件通道
- 只允许 R0 只读：读文件、搜代码、看日志、查网页
- 立即回执 + 进度 + 结果
- 失败兜底
- 验收：3 个真实只读任务，不污染记忆

### P2 可写 + 审批（建议 2–3 天）

- R1/R2 风险分级
- 微信审批卡、超时拒绝、主人校验
- 工作区白名单、审计
- 验收：改一个仓库文件、kill 一个测试进程、拒绝一次非主人审批

### P3 持续会话 + 恢复（建议 2 天）

- resume/cancel/查询进度
- 进程重启恢复
- 长任务进度节流
- 验收：任务中途重启，能续上或明确告知

### P4 主动/多代理（可选）

- 定时任务、主动汇报
- 多 DSH 子任务（Manager-Worker）
- 跨会话记忆交接
- 先不做，等 P1–P3 稳定

---

## 12. 测试计划

### 12.1 适配器契约

- 创建会话返回 sessionId
- 事件顺序：ack → progress → result
- 审批请求能暂停/恢复
- cancel 后不再发结果
- 重复创建同一 taskId 幂等

### 12.2 安全

- 非主人不能审批
- 审批超时默认拒绝
- 越界路径被拒
- 危险命令必须 R3
- 微信里的 prompt injection 不能提升权限

### 12.3 可靠性

- DSH 崩溃 → 鲸鲸仍能聊天
- 网络断 → 事件补发/重连
- 进程重启 → resume 或 interrupted
- 重复消息 → 不重复执行
- 长任务 → 有进度，不刷屏

### 12.4 记忆/人格

- 任务结果只写任务卡
- DSH trace 不进鲸鲸 prompt
- 失败不把 traceback 发到微信
- 结果用鲸鲸口吻重写

---

## 13. 指标

| 指标 | 目标 |
|---|---|
| 任务成功率 | ≥85%（P1 只读） |
| 首次回执 | ≤3 秒 |
| 审批到达 | ≤5 秒 |
| 卡住无响应 | <5% |
| 任务平均成本 | 可观测，设上限 |
| 记忆污染 | 0 条 DSH trace 进鲸鲸长期记忆 |
| 用户纠正率 | 逐周下降 |

---

## 14. 风险与回滚

| 风险 | 缓解 |
|---|---|
| 延迟高 | 先回执、进度节流、长任务后台 |
| 成本高 | 任务上限、模型分级、缓存 |
| 人格漂移 | 人设/执行分离，最终重写 |
| 权限过大 | 最小权限、白名单、审批、审计 |
| 记忆冲突 | 只记任务卡，不灌 trace |
| DSH 不稳定 | 超时/取消/兜底，不影响聊天 |
| 微信封控 | 保持现有桥接节奏，不因 Agent 加速 |

回滚：`brain.enabled=false` 即回到现有鲸鲸；DSH 会话和任务卡保留，不删数据。

---

## 15. 待确认决策

| 决策 | 默认建议 | 影响 |
|---|---|---|
| Adapter 放哪 | 鲸鲸 kernel | 离记忆/路由近，桥接只做传输 |
| 通信 | 本机 HTTP + 轮询/SSE | 简单、可观测；WS 可后补 |
| 首期权限 | 只读 | 最安全，先验证体验 |
| 审批范围 | 所有 R2/R3 | 安全优先 |
| 并发 | 每会话 1、全局 2 | 防打爆电脑 |
| 任务保留 | 7 天 | 可回查，不无限增长 |
| DSH 模型 | 与鲸鲸同源/独立可配 | 成本/能力权衡 |
| 是否让 DSH 上网 | 首期否 | 降低风险 |

---

## 16. 结论

推荐 **外挂执行脑**：鲸鲸保留人格和长期记忆，DSH 提供持续会话、工具、审批、恢复；先只读、再可写、再加审批和恢复；任何阶段都能用 feature flag 回滚。

**本轮没有改任何代码**，只完成调研、样本和计划书。下一步如果确认，按 P1 先做只读版，不直接上写权限。
