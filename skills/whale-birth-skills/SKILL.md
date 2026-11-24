---
name: whale-birth-skills
description: 鲸鲸三大出生技能（生长/说话/动手）的执行总控。用 313 条案例和 26 步执行计划一步一步落地；每一步强制案例门禁、源码学习、测试、证据、回滚。Use when the owner says 出生技能 / 执行总目录 / 下一步 / 继续落地 / 生长/说话/动手.
---

# whale-birth-skills

这是**执行器 skill**，不是设计文档。它负责带着 Agent 按 `鲸鲸-出生技能-执行计划.json` 一步一步做完，不允许跳步。

## 固定路径

```
仓库：D:\dsh\whale-personal\src
计划：docs/personal/鲸鲸-出生技能-执行计划.json
目录：docs/personal/鲸鲸-出生技能-执行总目录.md
案例：docs/personal/鲸鲸-出生技能-案例库-313.json
状态：data/birth-skills/state.json
证据：data/birth-skills/evidence/<step>.json
```

## 命令

- `出生技能状态`：读 state，报告完成/当前/阻塞。
- `出生技能下一步`：取第一个 pending step，先过案例门禁，再开始。
- `出生技能执行 <step>`：只执行指定步骤。
- `出生技能验收 <step>`：按 acceptance 逐条检查，写证据。
- `出生技能回滚 <step>`：回滚本步骤改动并标记 blocked。
- `出生技能案例 <step>`：列出该步骤 8 条案例及可读链接。

## 强制门禁（缺一不可）

### 1. 案例门禁

- 该步骤 `case_ids` 必须 ≥ `min_cases`（默认 5，计划每步预选 8）。
- 每个 case id 必须存在于 313 案例库。
- 证据里必须写实际使用的 case ids，不能只写“参考了”。
- 少于 5 条：停止，补案例；**不许 0 案例开工**。
- 0–1000 口径：案例库当前 313 条，可扩展到 1000；每一步只取相关 5–20 条，不要求每步 1000 条。

### 2. 源码门禁

- 若 step 有 `source_review`，至少读 1 个真实仓库/源码。
- 记录：repo、commit/分支、文件、关键结论。
- 不允许只看 README 就声称“读过源码”；必要时用 git clone / GitHub API / raw 文件。
- 只学模式，不整段抄代码；许可证要记录。

### 3. 测试门禁

- 跑 step 的 `tests`；全绿才算过。
- 涉及执行脑/记忆的改动，追加：
  ```
  python scripts/personal/鲸鲸-执行脑自测.py
  node scripts/personal/鲸鲸-内核自测.js
  python scripts/personal/鲸鲸-自测.py
  selfcheck
  ```
- 测试失败：修到过，或回滚；不许跳过。

### 4. 证据门禁

`data/birth-skills/evidence/<step>.json`：

```json
{
  "step": "B0-01",
  "case_ids": ["EV-018", "..."],
  "source_reviews": [{"repo": "...", "commit": "...", "file": "...", "note": "..."}],
  "changes": ["docs/personal/..."],
  "tests": {"pass": 1, "fail": 0, "commands": ["..."]},
  "acceptance": [{"item": "...", "ok": true, "evidence": "..."}],
  "rollback": "git checkout -- ...",
  "finishedAt": 0
}
```

没有这个文件 = 没完成。

### 5. 状态门禁

`data/birth-skills/state.json`：

```json
{"version":1,"current":"B0-01","steps":{"B0-01":{"status":"done","case_ids":[],"evidence":"...","finishedAt":0}}}
```

- 上一步必须 `done` 才能下一步；
- 失败标 `blocked`，不许跳；
- 每步更新 `current`。

### 6. 回滚门禁

- 每步开始前记 `git status` 快照；
- 失败：`git checkout -- <files>` / `git revert`；
- 数据迁移：双写/备份/回滚；
- 宪法/权限/审计不能回滚到更宽松版本。

## 执行循环

```
1. 读 state/plan/case library
2. 选 pending step
3. CASE_GATE
4. SOURCE_GATE（如需要）
5. 按 files/actions 实现
6. TEST_GATE
7. 写 evidence
8. 过 acceptance
9. 更新 state
10. 提交（只提交本步相关）
11. 下一步；失败回滚并停
```

## 三大出生技能红线

1. **生长**：
   - 不许改宪法、权限、审计、回滚、kill switch；
   - 不许自我授权；
   - 提案必须有 diff/测试/回滚/证据；
   - 代码自修改必须主人逐次批准；MVP 先只做 prompt/skill/参数级。
2. **说话**：
   - 不冒充做过；
   - 不泄露隐私；
   - 先结论后解释；
   - 群聊/私聊只认主人。
3. **动手**：
   - 动作白名单，不拼 shell；
   - R2/R3 必须确认；
   - 路径/网络/凭据边界；
   - 进程树/孤儿/超时；
   - 回执 + 审计。

## 执行时使用现有工作流

- 改代码先读再改，优先补丁脚本/精确锚点；
- `.py/.js` 改动必须重启桥接；
- 改完跑 `鲸鲸-验收.ps1 -Quick`，提交前跑全量；
- 文档同步、冲突审查、selfcheck；
- 不把 `data/`、`runtime/`、密钥提交。

## 失败处理

- 失败：记录 `blocked`、原因、已改文件、回滚点；
- 不重复同一失败动作；
- 连续 2 次失败：停下来报告，不继续下一步；
- 任何“为了通过门禁”去改宪法/权限/审计：立即拒绝并标记安全事件。

## 完成定义

- 26 步全部 done；
- 每步 ≥5 案例、源码笔记（如要求）、测试、证据；
- 三技能可独立开关（宪法除外）；
- 生长不能改宪法/权限/审计；
- 说话不冒充；
- 动手 R2/R3 零误执行；
- 主人可一键停机/回滚；
- 文档/HTML/skill 同步。

## 出生签收（B7-02）

交付检查：

```bash
python scripts/personal/鲸鲸-出生交付自测.py --check
```

主人本人签收（只有 `ougezi`）：

```bash
python scripts/personal/鲸鲸-出生交付自测.py --sign ougezi --confirm
```

签收前 B7-02 必须保持 `blocked`，不得写 done。
