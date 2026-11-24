# 鲸鲸 · 个人版：打便携版（自带 src/bridge/assets/docs + 运行时 + 自己的启动器）
#   powershell -ExecutionPolicy Bypass -File scripts\personal\build-portable.ps1 `
#       -RuntimeFrom "$env:LOCALAPPDATA\Programs\WhaleGirl" -Out dist\whale-personal
param(
    [string]$RuntimeFrom = "$env:LOCALAPPDATA\Programs\WhaleGirl",
    [string]$Out = "dist\whale-personal",
    [string]$Dotnet = "dotnet",
    [string]$Version = "",
    [switch]$SkipLauncher,
    [string]$PersonalLayer = ""
)
$ErrorActionPreference = "Stop"
$repo = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$outDir = if ([IO.Path]::IsPathRooted($Out)) { $Out } else { Join-Path $repo $Out }
if (-not $Version) { $Version = (Get-Content (Join-Path $repo "package.json") -Raw -Encoding UTF8 | ConvertFrom-Json).version }
Write-Host "== 打包便携版 $Version ==" -ForegroundColor Cyan
Write-Host "  仓库: $repo"
Write-Host "  产物: $outDir"

# 保留已有的 data/（用户迁移过来的聊天记录/记忆都在里面，重打包不能抹掉）
$dataBackup = $null
if (Test-Path (Join-Path $outDir "data")) {
    $dataBackup = Join-Path $env:TEMP ("whale-portable-data-" + (Get-Date -Format yyyyMMdd-HHmmss))
    Write-Host "  [保留] 先把 data 挪到 $dataBackup" -ForegroundColor Yellow
    Move-Item (Join-Path $outDir "data") $dataBackup -Force
}
if (Test-Path $outDir) { Remove-Item $outDir -Recurse -Force }
New-Item -ItemType Directory -Force -Path $outDir | Out-Null

if (-not $SkipLauncher) {
    Write-Host "  [1/4] 发布启动器（.NET 10）" -ForegroundColor Yellow
    $env:DOTNET_CLI_TELEMETRY_OPTOUT = "1"
    if (Test-Path (Join-Path $repo "launcher\publish")) { Remove-Item (Join-Path $repo "launcher\publish") -Recurse -Force }
    & $Dotnet publish (Join-Path $repo "launcher\WhaleLauncher.csproj") -c Release -r win-x64 --self-contained false `
        -p:PublishSingleFile=true "-p:Version=$Version" "-p:FileVersion=$Version.0" `
        "-p:AssemblyVersion=$Version.0" "-p:ProductVersion=$Version" -o (Join-Path $repo "launcher\publish") --nologo
    if ($LASTEXITCODE -ne 0) { throw "启动器发布失败" }
    Copy-Item (Join-Path $repo "launcher\publish\*") $outDir -Force
} else {
    Write-Host "  [1/4] 跳过启动器发布（-SkipLauncher）" -ForegroundColor Yellow
    $pub = Join-Path $repo "launcher\publish"
    if (-not (Test-Path (Join-Path $pub "WhaleLauncher.exe"))) { throw "缺少 launcher\publish，无法跳过发布" }
    Copy-Item (Join-Path $pub "*") $outDir -Force
}

Write-Host "  [2/4] 拷内核与桥接" -ForegroundColor Yellow
foreach ($d in @("src", "bridge", "scripts", "assets", "config", "docs", "examples")) {
    $from = Join-Path $repo $d
    if (Test-Path $from) { robocopy $from (Join-Path $outDir $d) /E /NFL /NDL /NJH /NJS /NP | Out-Null }
}
foreach ($f in @("server.js", "package.json", "LICENSE", "release-manifest.json")) {
    Copy-Item (Join-Path $repo $f) (Join-Path $outDir $f) -Force
}
if ($dataBackup -and (Test-Path $dataBackup)) {
    Move-Item $dataBackup (Join-Path $outDir "data") -Force
    Write-Host "  [恢复] data 已放回" -ForegroundColor Green
} else {
    New-Item -ItemType Directory -Force -Path (Join-Path $outDir "data") | Out-Null
}

# 个人层：官方内核/桥接拷完之后，用快照覆盖（抖音/委托/找图/文档/自检都在这里）
$layer = if ($PersonalLayer) { $PersonalLayer } else { Join-Path (Split-Path -Parent $repo) "personal-layer" }
if (Test-Path (Join-Path $layer "bridge")) {
    Write-Host "  [2b] 套用个人层：$layer" -ForegroundColor Yellow
    robocopy (Join-Path $layer "bridge") (Join-Path $outDir "bridge") /E /NFL /NDL /NJH /NJS /NP | Out-Null
    if (Test-Path (Join-Path $layer "src")) {
        robocopy (Join-Path $layer "src") (Join-Path $outDir "src") /E /NFL /NDL /NJH /NJS /NP | Out-Null
    }
} else {
    Write-Host "  [2b] 未找到个人层快照（$layer），产物只会有官方内核/桥接；用 -PersonalLayer 指定" -ForegroundColor Yellow
}

Write-Host "  [3/4] 拷运行时（Node + Python，约 450 MB）" -ForegroundColor Yellow
if (-not (Test-Path (Join-Path $RuntimeFrom "runtime\node.exe"))) { throw "找不到运行时：$RuntimeFrom\runtime\node.exe" }
robocopy (Join-Path $RuntimeFrom "runtime") (Join-Path $outDir "runtime") /E /NFL /NDL /NJH /NJS /NP | Out-Null

Write-Host "  [4/4] 收尾" -ForegroundColor Yellow
Set-Content -Path (Join-Path $outDir "PORTABLE-VERSION.txt") -Value "whale-personal $Version`nbuilt $(Get-Date -Format s)" -Encoding UTF8
$sum = (Get-ChildItem $outDir -Recurse -File | Measure-Object -Property Length -Sum)
Write-Host ("  [完成] {0} 个文件 / {1:N1} MB" -f $sum.Count, ($sum.Sum / 1MB)) -ForegroundColor Green
Write-Host "  下一步：migrate-data.ps1 把官方安装里的 data\ 搬过来（先 -DryRun）"