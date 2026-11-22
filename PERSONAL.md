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

## 还没剥离干净的地方（诚实清单）

- **插件市场目录**仍指向官方 `Banan1cee/whale-girl-plugins`（`launcher/PluginMarket.cs` 的
  `CatalogUrl` 等）。打开「插件市场」还是会去官方仓库读目录；要彻底自持，得把这份目录也 fork 过来。
- **运行环境**（Node / Python）目前从官方安装里拷，或用官方 `scripts/build-runtime.ps1` 现场构建；
  这一步是"官方脚本"，但产物是我们自己的。
- **.NET 10 桌面运行时**是系统级前置（官方安装器会在缺的时候静默装），便携版需要目标机器已装。
