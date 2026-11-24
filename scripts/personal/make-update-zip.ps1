# 鲸鲸 · 个人版：打增量更新包（只含代码与启动器，不含 runtime/assets/data）
#   powershell -ExecutionPolicy Bypass -File scripts\personal\make-update-zip.ps1
# 产物：dist\whale-personal-update-<版本>.zip（约 2~5 MB）
param(
    [string]$Out = "",
    [string]$Version = ""
)
$ErrorActionPreference = "Stop"
$repo = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
if (-not $Version) { $Version = (Get-Content (Join-Path $repo "package.json") -Raw -Encoding UTF8 | ConvertFrom-Json).version }
if (-not $Out) { $Out = Join-Path $repo "dist\whale-personal-update-$Version.zip" }
$staging = Join-Path $env:TEMP ("whale-update-" + [guid]::NewGuid().ToString("N").Substring(0,8))
New-Item -ItemType Directory -Force -Path $staging | Out-Null
Write-Host "== 打增量包 $Version ==" -ForegroundColor Cyan

foreach ($d in @("src", "bridge")) {
    robocopy (Join-Path $repo $d) (Join-Path $staging $d) /E /NFL /NDL /NJH /NJS /NP | Out-Null
}
robocopy (Join-Path $repo "scripts\personal") (Join-Path $staging "scripts\personal") /E /NFL /NDL /NJH /NJS /NP | Out-Null
# 启动器：优先用「已部署到 dist」的那份（它才是签名/版本最新的），launcher\publish 只作兜底
$deployed = Join-Path $repo "dist\whale-personal\WhaleLauncher.exe"
$pub = Join-Path $repo "launcher\publish"
if (Test-Path $deployed) {
    Copy-Item $deployed $staging -Force
    Write-Host "  启动器来源：dist\whale-personal（已部署版本）"
} elseif (Test-Path (Join-Path $pub "WhaleLauncher.exe")) {
    Copy-Item (Join-Path $pub "*") $staging -Force
    Write-Host "  启动器来源：launcher\publish（兜底）"
} else {
    Write-Host "  [警告] 没找到 WhaleLauncher.exe，包里不会带启动器" -ForegroundColor Yellow
}
foreach ($f in @("server.js", "package.json", "release-manifest.json", "LICENSE", "PERSONAL.md")) {
    $src = Join-Path $repo $f
    if (Test-Path $src) { Copy-Item $src (Join-Path $staging $f) -Force }
}
Set-Content -Path (Join-Path $staging "UPDATE-VERSION.txt") -Value $Version -Encoding UTF8

if (Test-Path $Out) { Remove-Item $Out -Force }
$distDir = Split-Path -Parent $Out
if (-not (Test-Path $distDir)) { New-Item -ItemType Directory -Force -Path $distDir | Out-Null }
Compress-Archive -Path (Join-Path $staging "*") -DestinationPath $Out -CompressionLevel Optimal
Remove-Item $staging -Recurse -Force
$size = (Get-Item $Out).Length
Write-Host ("  [完成] {0}（{1:N1} MB）" -f $Out, ($size / 1MB)) -ForegroundColor Green
Write-Host "  上传到 Release 时文件名保持一致；本地应用用 apply-update-zip.ps1"