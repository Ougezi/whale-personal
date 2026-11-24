# 鲸鲸 · 个人版：去掉「来自 Internet」标记（Mark-of-the-Web）
# 症状：双击 WhaleLauncher.exe 弹「打开文件 - 安全警告 / 无法验证发布者」。
# 原因：exe 是从浏览器/网盘/聊天工具下载或从 zip 解出来的，Windows 给它打了 Zone.Identifier。
# 这个脚本只做一件事：把目标目录（和可选的 zip）的 Zone.Identifier 删掉，不改内容、不碰 data。
param(
    [string]$Target = "",
    [string]$Zip = ""
)
$ErrorActionPreference = "Stop"
if (-not $Target) { $Target = Split-Path -Parent (Split-Path -Parent $PSScriptRoot) }
Write-Host "== 解除「来自 Internet」标记 ==" -ForegroundColor Cyan
Write-Host "  目录: $Target"

function Test-Motw([string]$path) {
    try { return [bool](Get-Item -LiteralPath $path -Stream Zone.Identifier -ErrorAction SilentlyContinue) } catch { return $false }
}

$count = 0
Get-ChildItem -LiteralPath $Target -Recurse -File -Include *.exe, *.dll, *.ps1, *.zip -ErrorAction SilentlyContinue | ForEach-Object {
    if (Test-Motw $_.FullName) {
        Unblock-File -LiteralPath $_.FullName -ErrorAction SilentlyContinue
        $count++
        Write-Host ("  解除 " + $_.FullName)
    }
}
if ($Zip -and (Test-Path -LiteralPath $Zip)) {
    Unblock-File -LiteralPath $Zip -ErrorAction SilentlyContinue
    $count++
    Write-Host "  解除 $Zip"
}
Write-Host "完成：处理 $count 个文件" -ForegroundColor Green
Write-Host "如果还弹提示，是 SmartScreen 对「未签名/低信誉」的提示；四六九版起可选用本地自签名证书签名（见 PERSONAL.md 4.9.1）"
