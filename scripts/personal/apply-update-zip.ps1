# 鲸鲸 · 个人版：在本地应用一个增量更新包（不动 data\ 与 runtime\）
#   powershell -ExecutionPolicy Bypass -File scripts\personal\apply-update-zip.ps1 -Zip dist\whale-personal-update-4.2.5.zip -Target "D:\dsh\whale-personal\src\dist\whale-personal"
param(
    [Parameter(Mandatory = $true)][string]$Zip,
    [Parameter(Mandatory = $true)][string]$Target,
    [switch]$NoRestart
)
$ErrorActionPreference = "Stop"
if (-not (Test-Path $Zip)) { throw "找不到更新包：$Zip" }
if (-not (Test-Path (Join-Path $Target "WhaleLauncher.exe"))) { throw "目标目录不像鲸鲸安装目录：$Target" }
Write-Host "== 应用增量包 ==" -ForegroundColor Cyan
Write-Host "  包: $Zip"
Write-Host "  目标: $Target"

# 1) 停掉目标目录里正在跑的启动器/内核/桥接
Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith($Target, 'OrdinalIgnoreCase') } | ForEach-Object {
    Write-Host "  停止 $($_.ProcessId) $($_.Name)"
    Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
}
Start-Sleep -Seconds 3

# 2) 备份将被覆盖的目录
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$bak = Join-Path $Target ("_pre-update-" + $stamp)
New-Item -ItemType Directory -Force -Path $bak | Out-Null
foreach ($d in @("src", "bridge", "scripts")) {
    if (Test-Path (Join-Path $Target $d)) { robocopy (Join-Path $Target $d) (Join-Path $bak $d) /E /NFL /NDL /NJH /NJS /NP | Out-Null }
}
Write-Host "  [备份] $bak"

# 3) 解压覆盖（data\ 与 runtime\ 不在包里，不会被碰）
$tmp = Join-Path $env:TEMP ("whale-apply-" + [guid]::NewGuid().ToString("N").Substring(0, 8))
Expand-Archive -Path $Zip -DestinationPath $tmp -Force
robocopy $tmp $Target /E /NFL /NDL /NJH /NJS /NP | Out-Null
if ($LASTEXITCODE -ge 8) { throw "覆盖失败（robocopy $LASTEXITCODE）" }
Remove-Item $tmp -Recurse -Force
$ver = if (Test-Path (Join-Path $Target "UPDATE-VERSION.txt")) { (Get-Content (Join-Path $Target "UPDATE-VERSION.txt") -Raw).Trim() } else { "?" }
Write-Host "  [完成] 现在是 $ver" -ForegroundColor Green

# 4) 重启（带 --autostart 就不用再点「启动」）
if (-not $NoRestart) {
    Start-Process -FilePath (Join-Path $Target "WhaleLauncher.exe") -ArgumentList "--autostart" -WorkingDirectory $Target
    Write-Host "  [启动] 已拉起启动器（--autostart）"
}
Write-Host "  回滚：把 $bak 里的目录拷回 $Target"
# 更新包从网上下载，解压出来的 exe 会带 Zone.Identifier；统一去掉，免得每次启动弹「无法验证发布者」
Get-ChildItem -LiteralPath $Target -Recurse -File -Include *.exe, *.dll -ErrorAction SilentlyContinue | ForEach-Object {
    try { if (Get-Item -LiteralPath $_.FullName -Stream Zone.Identifier -ErrorAction SilentlyContinue) { Unblock-File -LiteralPath $_.FullName -ErrorAction SilentlyContinue } } catch {}
}

