# 鲸鲸 · DSH 执行脑：改进执行计划

> 状态：执行中
> 日期：2026-11-24
> 依据：[测试报告与改进方案](鲸鲸-DSH执行脑-测试报告与改进.md)
> 目标：把测试报告里的 P0/P1/P2 改进项落成代码、测试、skill，并推送。
> 本轮不改鲸鲸人设/长期记忆；只增强执行脑的边界、审计、测试与发布门禁。

---

## 1. 目标与非目标

### 目标

1. **P0 硬边界**：工作区/凭据/危险动作不再只靠提示词，代码层拒绝；取消/超时后不发、不重试。
2. **P1 策略与审计**：统一 `BrainPolicy`；风险分级 R0–R3；任务/审批/拒绝/结果写审计。
3. **P2 评测与门禁**：执行脑自测支持 JSON 报告；发布前跑单元 + live；失败阻断。
4. **P3 体验**：审批卡带工作区/风险/回滚；进度节流；任务卡可回查。
5. **Skill**：测试流程做成 `whale-brain-testing`，上传仓库并安装。

### 非目标

- 不做 OS 级虚拟机/容器沙箱（当前是 DSH permission + 进程边界）。
- 不做多代理写；多代理只读。
- 不自动扩大 `D:\dsh` 白名单。
- 不改微信 UIA 发送链路。

---

## 2. 决策

| 决策 | 结果 | 理由 |
|---|---|---|
| 策略层 | 新增 `bridge/brain_policy.py`，BrainAgent 统一调用 | 不把安全散在 if 里 |
| 白名单 | 默认 `D:\dsh`；`WHALE_BRAIN_ROOTS` 可覆盖 | 与现有实现一致 |
| 拒绝路径 | `data/`、`backup/`、`settings.json`、`config.json`、`.env`、密钥名 | 防凭据/记忆泄露 |
| 网络 | 默认不允许；提示词约束 + 策略标记；不做 OS 断网 | DSH 无独立 network flag |
| 风险 | 只读 R0；写 R2；删除/进程/安装/外发 R3 | 审批文案可区分 |
| 审计 | `data/brain-audit.jsonl`；不含密钥/全文 | 可回查 |
| 测试 | `鲸鲸-执行脑自测.py` 单元 + `--live`；`--json` 报告 | 发布门禁可消费 |
| Skill | `whale-brain-testing` + 现有 `whale-brain-deploy` | 测试流程独立可复用 |

---

## 3. 阶段 P0：硬边界

### 3.1 策略检查

文件：`bridge/brain_policy.py`

```python
check(goal, workspace, mode) -> (ok, reason, risk)
```

检查顺序：

1. workspace 必须在 allowed roots；
2. workspace 不能含 `data/backup`；
3. 任务文本不能含 `data/backup` 路径段；
4. 任务文本不能含凭据文件：`settings.json`、`config.json`、`.env`、`id_rsa`、`credentials`；
5. 风险：read-only→R0；write→R2；含删除/进程/安装/外发→R3。

### 3.2 取消/超时停止条件

- 取消：杀进程树、状态 cancelled；worker/多代理不再发结果。
- 超时：状态 timeout；不再发最终结果；不自动重试。
- 审批超时：状态 cancelled；不再启动。
- 拒绝后：不自动重试；状态可查。

### 3.3 验收

- 写 `data/settings.json` 被拒；
- 写 `data/x`、`backup/x` 被拒；
- 只读任务读 `settings.json` 被拒；
- 取消/超时后没有后续消息；
- 拒绝后不自动重试。

---

## 4. 阶段 P1：审计与审批

### 4.1 审计事件

`data/brain-audit.jsonl` 每行：

```json
{"at":179...,"taskId":"...","chat":"...","action":"created|approval_requested|approved|rejected|started|done|failed|cancelled|timeout","mode":"read-only|workspace-write|multi-readonly","risk":"R0|R2|R3","goal":"...","reason":"...","seq":...}
```

不写：API key、消息全文、tool 输出全文。

### 4.2 审批卡

```
【需要确认】
任务：...
工作区：D:\...
风险：R2/R3
回滚：备份/撤销方式
回复「可以」执行；「不要」取消；5 分钟不回默认取消。
```

### 4.3 验收

- 每次创建/审批/拒绝/完成都有审计；
- 审批卡包含工作区/风险；
- 非主人批准无效；
- 超时/拒绝不启动。

---

## 5. 阶段 P2：测试与门禁

### 5.1 测试脚本增强

`scripts/personal/鲸鲸-执行脑自测.py`：

- 默认单元；
- `--live` 跑真实 DSH；
- `--json <path>` 输出 `{pass,fail,total,unit,live,durationMs}`；
- 失败 exit 1。

### 5.2 发布门禁

```bash
python scripts/personal/鲸鲸-执行脑自测.py --json data/brain-test-report.json
python scripts/personal/鲸鲸-执行脑自测.py --live --json data/brain-test-report-live.json
node scripts/personal/鲸鲸-内核自测.js
node scripts/health.js
```

### 5.3 验收

- 单元全绿；
- live P1/P2/P3/P4 + 注入全绿；
- JSON 报告可读；
- 失败阻断。

---

## 6. 阶段 P3：体验

- 审批卡带工作区/风险/回滚；
- 进度 45 秒一条，不刷屏；
- 任务卡 `【执行脑】目标 + 结果` 可回查；
- `脑子状态` 返回最近任务状态/原因。

---

## 7. 文件清单

| 文件 | 改动 |
|---|---|
| `bridge/brain_policy.py` | 新增策略/审计 |
| `bridge/brain_agent.py` | 接入 policy、audit、审批文案、停止条件 |
| `scripts/personal/鲸鲸-执行脑自测.py` | 政策/审计/JSON 报告 |
| `skills/whale-brain-testing/SKILL.md` | 测试 skill |
| `docs/personal/鲸鲸-DSH执行脑-测试报告与改进.md` | 更新结果 |
| `docs/personal/鲸鲸-DSH执行脑-改进执行计划.md` | 本计划 |

---

## 8. 风险与回滚

| 风险 | 缓解 |
|---|---|
| 白名单过严导致任务跑不了 | `WHALE_BRAIN_ROOTS` 覆盖；报错说明 |
| 审计写失败 | 不影响任务；只记日志 |
| 策略误拦 | 单元覆盖 + 明确 reason |
| 回滚 | 删 `brain_policy` 接入或关 `brain`；任务状态不删 |

---

## 9. 执行记录

| 日期 | 内容 | 验证 |
|---|---|---|
| 2026-11-24 | 计划书 | 本文件 |
| 2026-11-24 | P0/P1/P2 实现：policy/audit/JSON/test skill、只读硬隔离 patch | 39/39（33 单元 + 6 真实）；内核 287；桥接 110 |
