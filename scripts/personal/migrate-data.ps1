# 鲸鲸 · 个人版：把官方安装里的 data\ 搬到便携版（聊天记录 / 记忆 / 密钥都在这里）
#   powershell -ExecutionPolicy Bypass -File scripts\personal\migrate-data.ps1 `
#       -From "$env:LOCALAPPDATA\Programs\WhaleGirl\data" -To dist\whale-personal\data -DryRun
param(
    [string]$From = "$env:LOCALAPPDATA\Programs\WhaleGirl\data",
    [string]$To = "dist\whale-personal\data",
    [switch]$DryRun,
    [switch]$WithLogs
)
$ErrorActionPreference = "Stop"
if (-not (Test-Path $From)) { throw "找不到来源 data 目录：$From" }
$repo = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$toDir = if ([IO.Path]::IsPathRooted($To)) { $To } else { Join-Path $repo $To }
Write-Host "== 迁移 data ==" -ForegroundColor Cyan
Write-Host "  从: $From"
Write-Host "  到: $toDir"
Write-Host "  日志: $(if ($WithLogs) { '一起搬' } else { '跳过 *.log' })"

$excludeFiles = if ($WithLogs) { @() } else { @("*.log") }
$excludeDirs = @("logs", "backups")
if ($DryRun) {
    $sum = (Get-ChildItem $From -Recurse -File | Where-Object { $WithLogs -or $_.Extension -ne ".log" } | Measure-Object -Property Length -Sum)
    Write-Host ("  [预演] 将搬运 {0} 个文件 / {1:N1} MB（不含 logs/backups）" -f $sum.Count, ($sum.Sum / 1MB)) -ForegroundColor Yellow
    Write-Host "  确认后去掉 -DryRun 再跑一次"
    exit 0
}
if (-not (Test-Path $toDir)) { New-Item -ItemType Directory -Force -Path $toDir | Out-Null }
$args = @($From, $toDir, "/E", "/NFL", "/NDL", "/NJH", "/NJS", "/NP", "/XD") + $excludeDirs + @("/XF") + $excludeFiles
robocopy @args | Out-Null
if ($LASTEXITCODE -ge 8) { throw "robocopy 失败：$LASTEXITCODE" }
$sum = (Get-ChildItem $toDir -Recurse -File | Measure-Object -Property Length -Sum)
Write-Host ("  [完成] {0} 个文件 / {1:N1} MB" -f $sum.Count, ($sum.Sum / 1MB)) -ForegroundColor Green
Write-Host "  下一步：先关掉官方版，再启动便携版（WhaleLauncher.exe）；一份 data 同时给两边用会打架"