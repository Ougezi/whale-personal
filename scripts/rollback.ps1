# 版本回滚：把便携版恢复到最近一次 `src.pre-*` / `bridge.pre-*` 备份。
#
#   powershell -File scripts\rollback.ps1 -Root dist\whale-personal -List
#   powershell -File scripts\rollback.ps1 -Root dist\whale-personal           # 回滚到最新备份
#   powershell -File scripts\rollback.ps1 -Root dist\whale-personal -Stamp 20261122-181836
#
# 回滚前会把当前 src/bridge 另存为 *.before-rollback-<时间>，可再次回滚。
param(
    [string]$Root = 'dist\whale-personal',
    [switch]$List,
    [string]$Stamp = ''
)
$ErrorActionPreference = 'Stop'
if (-not (Test-Path -LiteralPath $Root)) { throw "目录不存在：$Root" }
$rootPath = (Resolve-Path -LiteralPath $Root).Path

function Backups([string]$name) {
    Get-ChildItem -LiteralPath $rootPath -Directory -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -like "$name.pre-*" -or $_.Name -like "$name.pre-layer-*" } |
        Sort-Object Name -Descending
}

$srcBackups = Backups 'src'
$bridgeBackups = Backups 'bridge'
if ($List) {
    Write-Host 'src 备份：'
    $srcBackups | ForEach-Object { Write-Host ('  ' + $_.Name) }
    Write-Host 'bridge 备份：'
    $bridgeBackups | ForEach-Object { Write-Host ('  ' + $_.Name) }
    return
}
if (-not $srcBackups -and -not $bridgeBackups) { throw '没有找到可回滚的 src/bridge 备份' }

if ($Stamp) {
    $srcPick = $srcBackups | Where-Object { $_.Name -like "*$Stamp*" } | Select-Object -First 1
    $bridgePick = $bridgeBackups | Where-Object { $_.Name -like "*$Stamp*" } | Select-Object -First 1
} else {
    $srcPick = $srcBackups | Select-Object -First 1
    $bridgePick = $bridgeBackups | Select-Object -First 1
}

$ts = Get-Date -Format 'yyyyMMdd-HHmmss'
foreach ($pair in @(@('src', $srcPick), @('bridge', $bridgePick))) {
    $name = $pair[0]; $pick = $pair[1]
    if (-not $pick) { Write-Host "  [跳过] 没有 $name 备份" -ForegroundColor Yellow; continue }
    $current = Join-Path $rootPath $name
    if (Test-Path -LiteralPath $current) {
        Rename-Item -LiteralPath $current -NewName ("$name.before-rollback-$ts")
    }
    Copy-Item -LiteralPath $pick.FullName -Destination $current -Recurse -Force
    Write-Host "  [回滚] $name ← $($pick.Name)" -ForegroundColor Green
}
Write-Host '回滚完成；重启启动器后生效。'
