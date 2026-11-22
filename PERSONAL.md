# 鲸鲸 · 个人版（whale-personal）

官方 [Banan1cee/whale_girl](https://github.com/Banan1cee/whale_girl) 的**个人分叉**：
基于官方 4.1.8 源码，并入「情绪 / 念头 / 自主上网」这一层，**启动器与更新渠道都改成自己的**，
以后不再跟随官方发版。

> 许可证仍是 AGPL-3.0（见 `LICENSE`）。这个分叉保留官方署名与许可，只是在它之上加东西。

## 跟官方版的区别

| 项 | 官方 | 个人版 |
|---|---|---|
| 版本线 | 4.1.8 | **4.2.0 起**（`package.json` / `launcher/WhaleLauncher.csproj`） |
| 更新检查 | `Banan1cee/whale_girl` Releases | **`Ougezi/whale-personal` Releases**（`launcher/UpdateManifest.cs` 的 `Repo` + `UpdateService.cs` 的下载地址） |
| 启动器 | 官方签名版 | 用本仓库源码 + .NET 10 SDK 自己发布（框架依赖、单文件，约 2.1 MB） |
| 情绪层 | 无 | 三轴 + 七情（各自半衰期）+ 六欲（会饿）+ 耦合 + 反刍，增量与衰减都是区间随机 |
| 念头流 | 无 | `data/thoughts.json`：3~5 条短念头跨轮携带、3 小时淡掉，可模型生成 |
| 自主上网 | 无 | 每 180 分钟刷一条热榜（微博/B站/头条），写回情绪与念头；`/browse` 页面 + 微信口令「去看看」 |
| 主动搭话 | 到点就发 | 到点 **且** 真的缺了什么才发（`care.followDesire`，默认开） |

## 目录

```
launcher/       WPF 启动器源码（.NET 10，net10.0-windows）
src/            内核（Node，CommonJS）
bridge/         微信桥接（Python）
scripts/        构建与发布脚本；个人版专用在 scripts/personal/
tools/personal/ 个人层的接线脚本（apply_personal_layer.py / apply_identity.py）
installer/      Inno Setup 打包（自带编译器）
dist/           本地便携版产物（不入库）
```

- **`api.github.com` 是这台机器上唯一稳定可达的 GitHub 域名**（实测 300–700ms），所以 4.2.7 起
  默认源第一项改用 **Contents API**：`/repos/<repo>/contents/release-manifest.json?ref=main`
  （`Accept: application/vnd.github.raw` 直接返回文件；必须带 `User-Agent`，否则 403）。
- jsDelivr 三个边缘域名保留作兜底，但它们在这台机器上时通时不通（刚才连续 12s 超时）。

### 数据迁移记录（2026-11-22）

| 项 | 结果 |
|---|---|
| 聊天 | 9 个会话全部对齐（portable ≥ official）；master 会话补了官方 14:22–14:33 的 16 条（seq 474–489） |
| checkpoints | 官方多出的 40 个按序号补齐，portable 现在 119 ≥ 官方 105 |
| config.json | 合并官方较新版本，**保留便携版自己的 32 位 token**；其余键与官方逐段一致 |
| persona.json | 采用官方 14:06 改过的版本（customPrompt 2539 字、quirks/taboos 齐全） |
| stickers / vector / media-cache / personas / diary / self / docs | 逐文件一致（63 图 / 1711 向量文件 / 28 缓存 / 2 人格） |
| 有意不迁 | 官方日志、官方 `backups/`（13 MB 历史快照）、`*.bak-*` 编辑备份 |

## 图片理解与本地 OCR 兜底（4.2.9）

- 正常路径：桥接把图发到内核 `/api/vision` → `src/adapters/vision.js` 用配置的视觉模型（智谱 GLM-4.6V-Flash
  或跟随聊天模型的服务商）出描述。
- **兜底路径**：没配视觉 Key、或视觉接口报错/超时 → 自动改用 **Windows 自带 OCR**（`scripts/ocr_image.py` +
  `src/adapters/localOcr.js`，走 `winsdk`，不需要任何 Key），把图上的字读出来，前缀「（本机 OCR，没配看图 Key）」。
  实测：造一张写着「鲸鲸图片识别测试 / OCR fallback works 123」的图，无 Key 和坏地址两种情况下都正确读出。
- 依赖：系统里要有 OCR 语言包（中文系统自带）；没有时返回空，仍会把原错误抛给调用方。

## 4.6.8：表情包只用「自己的库」，不再发搜图拼图

截图里她发的多格拼图/网图来自表情分类 **「搜来的」**（系统搜图时下载到 `data/stickers/搜来的`，
9 MB 一堆图，还被当成可用分类暴露给模型）。

修法：

- `src/adapters/stickers.js` 增加 `HIDDEN_CATEGORY_LABELS = new Set(['搜来的'])`：
  该分类**不出现在提示词分类表**里，`isUsableCategory('搜来的')` 返回 false（模型写标记也发不出去）；
- 现有 9 MB 网图整体移到 `data/stickers-disabled/搜来的`（不再参与发送）；
- 提示词新增：【只用自己的表情库】发图只用开心/傲娇/炸毛等自有分类，不发系统搜图下载的拼图/网图；
  主人明确说「搜一张图」时才走搜图。

实测：分类表从 `傲娇/炸毛/开心/搜来的` 变成 **`傲娇/炸毛/开心`**。

## 4.6.7：抖音图文读全 + 发送回执不再自己吓自己

- **图片去重 + 轮播翻页**：`browser.imagesFromPage` 按 pathname 去重，按右方向键翻 12 轮催懒加载；
  只收 `w>=600 && h>=800` 的竖版原图（跳过头像/横幅）。实测同一篇从 3 张变 **6 张**（66s，正文 1472 字）。
- **发送回执规则**：只有系统事实/【最近做过的事】明确写了失败，才可以说没发出去。
- **bridgeStatus 容忍 45s → 120s**：心跳 20s，发送中偶尔跳过会被误判离线。

## 4.6.6：抖音视频页走 sidecar，图文走浏览器原图

- sidecar 新增 `link` op（`whale-douyin/service.mjs`，借 `kb_video`），返回标题/作者/文案/话题/点赞 + 一帧截图。
- 内核新增 `src/adapters/douyinSidecar.js`（一次性进程，180s 超时）。
- `chat.readDouyinNote` 分流：短链先解析 `/share/note/` → 浏览器抓原图；视频页 → sidecar + 抓帧 + 转写。
- 实测：图文 55s（3 张）；视频 sidecar 约 2m12s（4 张，正文 1259 字）。

## 4.6.5：抖音分享链接真能读了（图文/视频页）

- 抖音分享页是 JS 壳，直连只拿到「在抖音记录美好生活」→ 改为 headless 渲染 + 抓图文原图 + 逐张转写。
- 实测（`v.douyin.com/G8Oggg_IXMA`）：`[douyin] 读到 3 张图，正文 1062 字`，她能概括 Product Hunt / 连发 100 天 / 盯竞品 / AI+SEO。

## 4.6.4：学习改成「次数上限」设计（按用户口径）

之前把 35/15 当增量、把 200 当「意」的数值上限，理解错了。按「上限 = 学习次数」重做：

| 来源 | 每次增量（浮动） | 每天计学习次数上限 |
|---|---|---|
| 自主刷抖音/上网 | **+25 ~ 50** | **200 次** |
| 主人分享 | **+10 ~ 20** | **100 次** |

- 超过次数上限：**不再涨「意」**（返回 `capped: true`），但仍然可以继续看/分享；
- 次数按**本地日期**重置，计数写在 `data/mood.json` 的 `learn: { day, auto, owner }`；
- 六欲数值上限仍是 `WANT_MAX = 250`（那是**数值**上限，和学习次数是两回事）；
- 旧的 35/15 语义已删除；内核自测新增 5 条学习断言 → **123/123**，个人层 **12/12**。

## 4.6.3：35/15 改成「上限」语义 + 三处歧义修复

- **学习增量不再固定**：35 和 15 是**上限**，实际取 `上限 × 50%~100%` 随机浮动
  → 自主上网 **18~35**、主人分享 **8~15**（实测 300 次：自主 18 个不同值、主人 8 个不同值）。
  自检也从「=== 35」改成「落在 [上限一半, 上限] 且确实浮动」。
- **`EMOTION_TRIGGER` 旧标量别名已删除**（内部从没用过，和 `EMOTION_RANGE` 并存容易看混）。
- **催促的怒独立成常量 `PRESSURE_ANGER_RANGE = [0.08, 0.12]`**，不再散落魔法数字。
- **六欲上限 200 → `WANT_MAX = 250`**（四处 clamp 统一用常量），长聊时「意」不再很快顶格；
  实测 `nudge({意:400})` → 250。
- 内核自测 **118/118**、个人层断言 **12/12**。

## 4.6.0：视频链接抽帧看画面

- `browser.describeVideo(url)`：用 CDP 打开页面 → 找视频地址（`video.currentSrc` / `og:video` / `<source>`，
  再加上页面 HTML 里的 `play_addr|playwm|/video/tos/` 地址）→ 下载（校验 content-type/`ftyp`，非视频直接跳过）
  → ffmpeg 抽 3 帧 → 交给视觉模型逐帧描述 → 拼成「【视频画面】」塞进链接正文。
- 聊天里视频类链接预算放宽到 30s，抽帧失败会如实说「没拿到画面」。
- **抖音/快手不走这条路**：它们由基线的 `[[dy:…]]` + 桥接 sidecar（`bridge/douyin_agent.py`，独立 Chrome profile 和配额）处理，`chat.readLink` 里对这类域名直接跳过抽帧，避免两条通道重复抓。
- 实测：本地 mp4 页面 → 3 帧全部抽出并成功调用视觉；B站链接 → 拿到的是 HTML，日志明确
  `拿到的不是视频文件（text/html）`，她的回复也如实降级。
- 局限：抖音/B站多用 blob/MSE 或需要登录/签名，**没有平台接口时拿不到画面**；直链 mp4 的页面可用。

## 4.5.0：主动开页 + 持久登录态 + 抓取统计

- **[[open:URL]] 工具循环**：她可以在回复末尾写 `[[open:https://…]]`（每轮最多一个）；内核抓那一页正文，
  再把正文交给她重新回答一次（标记会被剥掉）。实测：让她写标记打开 example.com →
  日志 `[open] https://example.com ok chars=911 ms=880`，回复变成「打开了，这页是标准示例域名…」
- **持久浏览器 profile**：headless 浏览器改用 `<便携目录>/data/browser-profile`，Cookie/登录态保留；
  可用环境变量 `WHALE_BROWSER_PROFILE` 换目录。实测目录已生成，重复抓取复用同一 profile。
- **抓取统计**：每次 `/api/fetch` 追加一行到 `data/fetch-stats.jsonl`
  （`at/url/method/ok/chars/ms/title`），响应里也带 `ms`；日志加 `ms=…`。
  实测：example.com 911 字 / 2361ms，baidu 245 字 / 1560ms。

## 浏览器与网页抓取（4.4.0）

- `src/adapters/browser.js`：先 HTTP 直连（`links.describeLink`，快），正文 <160 字或失败时
  起 **本机 headless Chrome/Edge**，用 **CDP**（`/json/new` + WebSocket → `Runtime.evaluate('document.body.innerText')`）
  拿渲染后的正文。浏览器进程复用，空闲不关；私网地址默认拒绝。
- `POST /api/fetch`（需 `x-bot-token`）→ `{ok,method,title,text}`，`mode:'browser'` 可强制走浏览器。
  `GET /api/fetch/browser` 报告本机浏览器路径。
- 聊天里「对方发链接」的读取链也接了浏览器兜底：直连拿不到正文就渲染一次再喂给提示词。
- 实测：
  - `https://example.com` → method=browser，911 字，首次 2.5s（启动浏览器），复用后 0.1s
  - `https://www.baidu.com` → method=browser，237 字，title=百度一下，你就知道
  - 无 token 调 `/api/fetch` → 401
  - 私聊发 example.com 链接 → 她能说出「打开就是那个示例页」

> 为什么用 CDP：这台机器的 Chrome 157 / Edge 的 `--dump-dom` 各种 headless 组合都输出 0 字节，
> 但 remote debugging 正常，所以改走 CDP（Node 24 自带 WebSocket，不需要额外依赖）。

### 使用方式

```powershell
$t = (Get-Content "<便携目录>\data\config.json" -Raw | ConvertFrom-Json).gateway.wechat.inboundToken
Invoke-RestMethod "http://127.0.0.1:8787/api/fetch?token=$t" -Method Post -ContentType 'application/json' `
  -Body '{"url":"https://example.com"}'            # 自动：直连优先，必要时渲染
Invoke-RestMethod "http://127.0.0.1:8787/api/fetch?token=$t" -Method Post -ContentType 'application/json' `
  -Body '{"url":"https://example.com","mode":"browser"}'   # 强制浏览器
```

## 4.3.0：看图接口加锁 + 联网自我认知

- `/api/vision`、`/api/vision/test` 现在校验 `x-bot-token`（也接受 `?token=` 或 body.token）：
  实测**不带 token 401、带 token 200**；桥接的 `ThreadLocalHTTP` 加了 `default_headers`，
  启动时统一带 `x-bot-token`，实测「桥接式」请求 200 正常。
- 提示词补一条真实能力说明（`persona/prompt.js` 的 `webSearchContext` 兜底分支）：
  「你能联网：天气/新闻会自动搜，也能读对方发来的链接正文；只有本次确实没搜到才说『这次没查到』，
  不要说自己没有联网权限。」
  实测问「你能联网吗」→ 她答：「能啊，刚才那链接我就是联网读的。查天气、新闻、发来的链接都行，
  搜不到的时候我会直说。」
- 链接读取超时 12s 生效（日志里 `budgetMs=12000`）。

## 每个场景的 token 花费（实测，2026-11-22）

测法：`whale.log` 里每次 LLM 调用会写一行
`用量 · 命中 X / 输入 Y（命中率）/ 输出 Z · 估算 N · ¥cost`，直接解析这些行；图片另用同一模型的
vision 接口实测 `usage`。

| 场景 | 输入 tokens | 输出 tokens | 单次合计 | 实测成本 |
|---|---|---|---|---|
| 私聊普通回复 | 3.7k~6.1k（均值 ≈4.0k，缓存命中 35~69%） | 26~72（均值 ≈40） | **≈4.0k** | ¥0.0014~0.0041（均值 ≈0.0017） |
| 群聊被 @ 回复 | ≈3.9k~4.2k | 30~50 | **≈4.1k** | ≈0.0018 |
| 主人分享链接（含正文注入） | ≈4.2k 起（正文最多 1200 字，估 +0.6k~0.8k） | 30~50 | **≈4.2k~5.0k** | ≈0.0017~0.0020 |
| 自主上网（自己刷一条） | 111 | 12 | **123** | ≈0.0002 |
| 图片理解（整屏截图 1152×2560） | 988 | 200（顶到 max_tokens） | **≈1.2k** | ≈0.0005 |
| 图片理解（小图 640×220） | 235 | 181 | **416** | ≈0.0002 |
| 主动搭话（care） | ≈4.0k | 30~60 | ≈4.1k | ≈0.0017 |
| 念头生成（后台，每 30 分钟一条上限） | 估 ≈1.1k | ≈50 | ≈1.2k | ≈0.0005 |
| 记忆摘要 / 日记（夜间批处理） | 估 ≈3k | ≈200 | ≈3.2k | ≈0.0013 |

### 每日花费预估（按「中度使用」假设）

| 场景 | 每天次数 | 日 tokens |
|---|---|---|
| 私聊 | 40 | ≈160k |
| 群聊 | 20 | ≈82k |
| 自主上网 | 5 | ≈0.6k |
| 主人分享 | 3 | ≈15k |
| 图片 | 3 | ≈3.6k |
| 主动搭话 | 2 | ≈8k |
| 念头生成 | 8 | ≈10k |
| 摘要/日记 | 2 | ≈6k |
| **合计** | — | **≈285k tokens/天** |

按当前 deepseek-flash 实测单价折算：**≈¥0.12/天 ≈ ¥3.6/月**（缓存命中越高越便宜；
日志里还会标「谷时」折扣）。如果私聊量翻倍，主要增量就在私聊那 160k 上。

## 4.2.9 的几项优化（实测）

| 项 | 之前 | 现在 |
|---|---|---|
| 自主上网单次 token | 104 prompt + 116 completion = **220** | 111 + 12 = **123**（prompt 里加「只回一句，别解释」，`maxTokens: 120`） |
| 六欲上限 | 100 | **250**（学习增量按上限浮动，不再立刻顶格） |
| 链接读取超时 | 6s | **12s**（慢站更容易读到正文） |
| 图片没 Key | 直接报错"看不到图" | **本机 OCR 兜底**，仍能读图上的字 |

## 学习增量与上网 token 成本（4.2.8）

「好奇被满足」写在六欲的 **意** 上（上限 250，每小时自然掉 4.5~5.5）：

| 来源 | 增量 | 说明 |
|---|---|---|
| 自主上网（自己刷热榜） | **+25~50**（每天最多 200 次计学习） | `mood.bumpLearn(dir, 'auto')` |
| 主人分享（你发链接，她读到了） | **+10~20**（每天最多 100 次计学习） | `mood.bumpLearn(dir, 'owner')`，读不到链接就不加 |

### 真实 token 成本（2026-11-22 实测，deepseek-flash）

用内核同一份提示词和参数（`SYSTEM` 80 字 + 一条热榜标题、`temperature 0.95`、`max_tokens 300`）打了一次真实请求：

```
prompt_tokens=111  completion_tokens=12  total=123（优化前：104 / 116 / 220）
```

- **自主上网**：每次 ≈ **123 tokens**（4.2.9 前是 220，加了「只回一句」+ maxTokens 120；热榜抓取本身不花 token）
  - 按额度 5 次/天：≈ **1,100 tokens/天**、≈ **33k/月**、≈ **40 万/年**
  - 按实测每次 0.2k 算，5 次也就 ¥0.00x 级别（DeepSeek 输入/输出单价另算）
- **主人分享的链接**：读网页不调模型（0 tokens），但正文最多 1200 字会进那一轮的提示词，
  ≈ **+600~800 prompt tokens/次**，再加当轮回复
- 落盘、六欲衰减、念头写入都不花 token

## 和官方版共存（本机已处理）

两个安装共用 **8787** 端口，只能活一个。本机已经把官方版「停下来」：

- `%LOCALAPPDATA%\Programs\WhaleGirl\WhaleLauncher.exe` → 改名为 **`WhaleLauncher.exe.disabled`**
  （数据原样保留；想恢复就改回去）
- 开始菜单「鲸鲸」快捷方式已改指向个人版的 `start-portable.cmd`
- 桌面快捷方式 `鲸鲸 · 个人版.lnk` 同样指向它
- 2026-11-22 14:47 做过一次记忆合并：官方版 14:22–14:33 期间处理过的消息（`seq 474–489`，16 条）
  已并入便携版 master 聊天，`summary.json` 取官方较新版本；合并前备份在
  `<便携目录>\data\_merge-backup-20261122-144724`

> 以后要再开官方版，先把 `.disabled` 改回 `.exe`，并且**先关掉个人版**（否则两边抢端口，
> 内核会以 code=1 退出）。

## 启动失败怎么排查（4.2.6 起有明确提示）

**最常见原因：8787 端口被另一份鲸鲸占用**（官方版和个人版共用同一个端口，只能活一份）。
4.2.5 及以前的启动器遇到这种情况只写一句「内核已在后台运行」就跳过，看起来就像"点了没反应"。

4.2.6 起：

- 启动器会检查占用 8787 的进程**是不是自己这份**；不是就报
  `端口 8787 被另一份鲸鲸占用：<路径>。请先关掉那个实例，再点「启动」。`
- 桌面快捷方式改成 `start-portable.cmd` → `scripts/personal/start-portable.ps1`：
  发现端口被别的鲸鲸占用时会**问你要不要关掉**（`-ForceClose` 不问直接关），关完再启动、并等内核就绪。

手动排查三步：

```powershell
Get-NetTCPConnection -LocalPort 8787 -State Listen | Select OwningProcess   # 谁占着
(Get-Process -Id <pid>).Path                                                # 是哪一份
Get-Content "<便携目录>\data\launcher.log" -Tail 20                          # 启动器自己怎么说
```

## 开机自启（个人版加的）

启动器原本打开后不会自动拉起内核（要手点「启动」）。个人版加了 `--autostart`：

```powershell
# 开机自启（写进当前用户 Run 键；不需要管理员）
New-ItemProperty -Path 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run' -Name 'WhalePersonal' `
  -Value '"D:\dsh\whale-personal\src\dist\whale-personal\WhaleLauncher.exe" --autostart' -PropertyType String -Force
```

带 `--autostart` 时，窗口加载完、更新检查结束后会自动 `StartAllAsync()`（内核 + 桥接），
实测 6 秒内 8787 起来。取消自启删掉这个 Run 键即可。

## 本机怎么构建 / 打便携版

需要 .NET 10 SDK（没有就用 `dotnet-install.ps1 -Channel 10.0`）；运行环境（Node + Python）由
`scripts/build-runtime.ps1` 产出，或直接从已有的官方安装里取。

```powershell
# 1) 发启动器（单文件、框架依赖，用户机器要有 .NET 10 桌面运行时）
dotnet publish launcher/WhaleLauncher.csproj -c Release -r win-x64 --self-contained false `
  -p:PublishSingleFile=true -p:Version=4.2.0 -p:FileVersion=4.2.0.0 `
  -p:AssemblyVersion=4.2.0.0 -p:ProductVersion=4.2.0 -o publish

# 2) 打便携版（把 src/bridge/assets/config/docs/runtime + 新启动器装进一个文件夹）
powershell -ExecutionPolicy Bypass -File scripts/personal/build-portable.ps1 `
  -RuntimeFrom "$env:LOCALAPPDATA\Programs\WhaleGirl"

# 3) 把官方安装里的 data/ 搬过来（聊天记录、记忆、密钥都在里面；先看 -DryRun）
powershell -ExecutionPolicy Bypass -File scripts/personal/migrate-data.ps1 `
  -From "$env:LOCALAPPDATA\Programs\WhaleGirl\data" -To "dist\whale-personal\data" -DryRun
```

## 更新渠道

启动器启动后会拉 `https://github.com/Ougezi/whale-personal/releases/latest/download/release-manifest.json`。
本仓库的 `release-manifest.json` 是源头；发版时：

1. 改 `package.json` 版本（`node scripts/bump-version.js minor` 之类）；
2. 重新发布启动器 + 打便携包；
3. 建一个 `vX.Y.Z` Release，把 **`release-manifest.json`** 挂成资产（文件名必须一致）；
4. 想推更新就把 manifest 的 `latest` 指到新版本。

### 仓库可见性与网络（重要）

- 启动器的更新检查是**匿名 HTTP**，私有仓库的 Release 资产匿名拉不到（404）。所以本仓库已设为
  **public**（AGPL 分叉本来就该公开源码）。想改回去：
  `gh api -X PATCH repos/Ougezi/whale-personal -f private=true`，但那样启动器就检查不到更新了。
- 这台机器上 `github.com/.../releases/download/`、`raw.githubusercontent.com` 和几个镜像**全部超时**
  （`api.github.com` 正常、`git push` 间歇成功）。也就是说：**代码和清单都对了，但这台机器的网络
  拉不到清单**，启动器会静默跳过更新检查。

### 自查更新渠道（个人版加的）

```powershell
# 清单一拉、判定完就退出；结果写在 %TEMP%\whale-check-update.json
& "<便携目录>\WhaleLauncher.exe" --check-update
Get-Content "$env:TEMP\whale-check-update.json" -Raw
```

输出里有 `current / latest / hasUpdate / policy / error / sources`。

### 换一个能拉到的清单地址

网络到不了 GitHub 时，在这个文件里写一行地址（可 `#` 注释），它会排在所有默认源**前面**：

```
<app>\data\update-source.txt      # 例如 http://127.0.0.1:8123/release-manifest.json
```

实测：指到本地 http 服务、清单里 `latest=9.9.9` → `--check-update` 返回
`{"latest":"9.9.9","hasUpdate":true,"policy":"Warn"}`；不写这一行则回退到默认源 + 上次缓存。

### 默认源里已经加了能通的镜像（4.2.4 起）

这台机器上 `github.com/.../releases/download`、`raw.githubusercontent.com`、`gh-proxy`、`cdn.jsdelivr.net`
全都超时/重置，但 **jsDelivr 的边缘域名能通**：`gcore.jsdelivr.net`、`fastly.jsdelivr.net`、
`testingcf.jsdelivr.net`（它们回源到同一个公开仓库，不需要额外账号/存储）。默认源顺序：

```
gcore@latest → fastly@latest → testingcf@latest → cdn@latest → GitHub Release → raw → gh-proxy
```

插件市场下载候选取加同样三个边缘域名（`launcher/PluginMarket.cs`），
实测 `gcore.jsdelivr.net/gh/Ougezi/whale-girl-plugins@main/index.json` 返回 200。

> 本机「自己想办法存储」的落点就是：**不租存储**，用 jsDelivr 对公开仓库的多域名回源。
> 要完全自持，把清单放到自己的静态地址，写进 `data\update-source.txt` 即可（不用改代码）。

### 两个必须知道的缓存坑（实测）

1. **`@main` 有约 12 小时缓存**：4.2.4 发完，`@main` 还返回 4.2.3。所以 4.2.5 起改用 `@latest`。
2. **`@latest` 是「最新 tag」的别名，切换也有延迟**：v4.2.5 打好后 45 秒内仍解析到 4.2.4；
   `purge.jsdelivr.net` 对别名不生效（对具体文件路径生效）。
   - 权威源永远是 **GitHub Release 资产**（发版即新）；
   - 这台机器到不了 GitHub，所以版本号可能滞后十几分钟到几小时；
   - 想立刻生效：`--check-update` 前删 `%LOCALAPPDATA%\WhaleGirl\update-state.json`，
     或把最新清单放到自己地址并写进 `update-source.txt`。

### 发版建议（清单版本号要递增）

`release-manifest.json` 的 `manifest_version` 是「谁更新」的判据（取所有源里最大的）。
每次发版把它加一（例如按日期 `2026112201`），这样即使某个 CDN 还在返旧缓存，只要有一个源
拿到新清单就会赢；不发版时改这一行也能立刻刹车/公告。

## 增量更新包（4.2.4 起）

不传 470 MB 的整包，只传**代码增量**：

```powershell
# 打增量包（src/bridge/启动器/脚本，不含 runtime、assets、data）→ 约 1.8 MB
powershell -ExecutionPolicy Bypass -File scripts\personal\make-update-zip.ps1

# 本地应用（会先停进程、把 src/bridge/scripts 备份成 _pre-update-<时间戳>、再覆盖、自动重启）
powershell -ExecutionPolicy Bypass -File scripts\personal\apply-update-zip.ps1 `
  -Zip dist\whale-personal-update-4.2.4.zip -Target "<便携目录>"
```

发布时把 `whale-personal-update-<版本>.zip` 和 `release-manifest.json` 一起挂到 Release 资产即可。

## 自检脚本怎么用

> 一条命令：`npm run check-personal`；完整流程（内核 117 / 桥接 100 / 整轮 selfcheck）见技能 `whale-personal-check`。
> 自检用的四个脚本已放进 `scripts/personal/`（内核自测 / 自测 / 冲突审查 / 文档同步），便携版自带，
> 不再依赖 `D:\dsh\profiles\desktop`。

| 命令 | 查什么 |
|---|---|
| `npm run check-personal` | 个人层关键行为（六欲 250、学习上限 35/15、maxTokens 120、OCR 兜底、两个 API 的 token、CDP/持久 profile/抽帧、[[open]] 执行+剥离、提示词、更新源、启动器、配置默认、版本一致） |
| `node scripts/health.js` | 基线：内核语法、桥接编译、文档参数同步、个人层提示词、启动器隔离 |
| `npm run check-layers` | 分层依赖没有反向引用 |
| `node scripts/release-check.js --release` | 发布一致性（版本/manifest/资产） |

> 4.6.0 基线自带 health/release-check；`check-personal.js` 只守「个人层被覆盖」这类回归，
> 两者互补。每次改动个人层后先跑 `npm run check-personal`。

## 还没剥离干净的地方（诚实清单）

- **插件市场目录**仍指向官方 `Banan1cee/whale-girl-plugins`（`launcher/PluginMarket.cs` 的
  `CatalogUrl` 等）。打开「插件市场」还是会去官方仓库读目录；要彻底自持，得把这份目录也 fork 过来。
- **运行环境**（Node / Python）目前从官方安装里拷，或用官方 `scripts/build-runtime.ps1` 现场构建；
  这一步是"官方脚本"，但产物是我们自己的。
- **.NET 10 桌面运行时**是系统级前置（官方安装器会在缺的时候静默装），便携版需要目标机器已装。
