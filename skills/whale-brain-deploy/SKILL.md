---
name: whale-brain-deploy
description: 鲸鲸 DSH 执行脑的部署/验收 runbook：P1 只读、P2 审批写、P3 续跑、P4 定时/多代理只读。Use when installing, changing, testing, or releasing the 脑子： feature of 鲸鲸, or when a brain task is stuck/denied.
---

# whale-brain-deploy

仓库：`D:\dsh\whale-personal\src`
运行目录：`D:\dsh\whale-personal\src\dist\whale-personal`

## 架构（先看）

```
微信主人私聊
  → bridge BrainMixin
    → BrainAgent（P1/P2/P3/P4）
      → DSH headless --json --permission-mode
        → 结果发回微信 + POST /api/memory/brain 写任务卡
```

- Adapter 在**桥接层**；内核只提供 `POST /api/memory/brain`。
- 只有主人私聊、只有这些前缀触发：`脑子：`、`脑子写：`、`脑子继续：`、`脑子深查：`、`脑子状态`、`脑子取消`、`脑子定时：`。
- 工作区白名单默认 `D:\dsh`（`WHALE_BRAIN_ROOTS` 可覆盖），拒绝 `data/`、`backup/`。
- `脑子：` **永远只读**；只有 `脑子写：` 进入审批。
- P4 多代理是**只读侦察 + 汇总**，不做多代理写。

## 改完后的标准流程

```powershell
cd D:\dsh\whale-personal\src

# 1) 基线
git status --short
node scripts/personal/鲸鲸-内核自测.js
node scripts/health.js
python scripts/personal/鲸鲸-自测.py

# 2) 执行脑单元
python scripts/personal/鲸鲸-执行脑自测.py

# 3) 如果改了 BrainAgent/DSH 调用，跑真实链路
python scripts/personal/鲸鲸-执行脑自测.py --live

# 4) 重启桥接（.py/.js 改动必须重启）
# 启动器点“重启”，或关闭 WhaleLauncher 后重新启动
```

## 重启后验收

```powershell
# 桥接日志应出现
#   执行脑已就绪（脑子：/脑子写：/脑子状态）
Get-Content D:\dsh\whale-personal\src\dist\whale-personal\data\bridge.log -Tail 20

# 应用状态
# GET http://127.0.0.1:8787/api/status（带 x-bot-token）
# 期望 uia=true, accountOk=true, warming=false
```

真实试一条（微信主人私聊）：

```
脑子：查一下 D:\dsh\whale-personal 为什么启动失败
```

期望：先回“在看了”，最终给结论+证据；不改文件。

## 常见故障

| 现象 | 检查 |
|---|---|
| 没有“执行脑已就绪” | bridge 启动日志、`brain_agent.py` 导入错误、`G.MASTER_WXID` 是否为空 |
| 命令没反应 | 是否主人私聊、前缀是否带冒号/空格、`_allowed_workspace` 是否拦了 |
| 一直“在看了” | DSH API key、`DeepSeek Harness.exe`/`app.asar` 路径、4 分钟超时 |
| 写到不允许目录 | 默认只允许 `D:\dsh`；`data/backup` 永远拒绝 |
| 审批不回 | 5 分钟默认拒绝；查 `data/brain-tasks.json` 的 pending |
| 任务重复 | `taskId`/session 状态；重启会把 running 标 interrupted |
| 多代理不汇总 | Scout 失败会降级为 A/B 原文；看 `scouts` 字段 |

## 发布

```powershell
git add bridge\brain_agent.py bridge\brain_mixin.py bridge\app.py bridge\receiver_mixin.py src\http\routes\memory.js
git add scripts\personal\鲸鲸-执行脑自测.py docs\personal\*.md
git commit -m "执行脑：<改了什么>（内核/桥接测试数）"
git push origin release:release
git push origin release:main
# 分开核对 refs，别被输出顺序骗了
git ls-remote origin refs/heads/release refs/heads/main
```

## 测试证据（2026-11-24）

- 单元 25/25；真实 DSH 5/5（P1/P3/P2/P4 + 注入）
- 修复：多代理取消仍发送、`data/` 文本路径绕过、`脑子：` 被写意图误升级
- 内核 287/287、桥接 110/110、health/selfcheck 通过

## 参考

- `docs/personal/鲸鲸-DSH执行脑-测试报告与改进.md`
- `docs/personal/鲸鲸-DSH执行脑-分阶段Skill计划.md`
- `docs/personal/dsh-brain-plan.html`
