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
  拉不到清单**，启动器会静默跳过更新检查。换一个能访问 GitHub 下载域名的网络就正常；
  或者以后把清单也放到国内可达的地方（改 `UpdateManifest.Sources` 即可）。

## 还没剥离干净的地方（诚实清单）

- **插件市场目录**仍指向官方 `Banan1cee/whale-girl-plugins`（`launcher/PluginMarket.cs` 的
  `CatalogUrl` 等）。打开「插件市场」还是会去官方仓库读目录；要彻底自持，得把这份目录也 fork 过来。
- **运行环境**（Node / Python）目前从官方安装里拷，或用官方 `scripts/build-runtime.ps1` 现场构建；
  这一步是"官方脚本"，但产物是我们自己的。
- **.NET 10 桌面运行时**是系统级前置（官方安装器会在缺的时候静默装），便携版需要目标机器已装。
