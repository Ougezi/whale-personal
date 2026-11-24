# 安全启动：发现 8787 被别的鲸鲸实例占用时先问，避免"启动没反应"
param([string]$Target = "", [switch]$ForceClose, [switch]$NoStart)
$ErrorActionPreference = "Stop"
if (-not $Target) { $Target = Split-Path -Parent (Split-Path -Parent $PSScriptRoot) }
$exe = Join-Path $Target "WhaleLauncher.exe"
if (-not (Test-Path $exe)) { throw "找不到 $exe" }
# 从 zip/聊天工具出来时 exe 带 Mark-of-the-Web，双击会弹「无法验证发布者」；启动前顺手去掉
try { Unblock-File -LiteralPath $exe -ErrorAction SilentlyContinue } catch {}
Write-Host "== 启动鲸鲸 · 个人版 ==" -ForegroundColor Cyan
Write-Host "  目录: $Target"

# 本目录的启动器可能还开着但内核已经死了（点过停止 / 内核退出）——先收掉再重起，避免单实例锁把新窗口顶掉
$stale = Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -and $_.ExecutablePath.Equals($exe, "OrdinalIgnoreCase") }
if ($stale) {
    foreach ($p in $stale) { Write-Host "  收掉旧的启动器 pid=$($p.ProcessId)"; Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue }
    Start-Sleep -Seconds 3
}

function Get-PortOwner {
    $conn = Get-NetTCPConnection -LocalPort 8787 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $conn) { return $null }
    return Get-Process -Id $conn.OwningProcess -ErrorAction SilentlyContinue
}

$owner = Get-PortOwner
if ($owner) {
    $path = ""
    try { $path = $owner.Path } catch { }
    Write-Host ("  端口 8787 被占用：pid={0} {1}" -f $owner.Id, $path) -ForegroundColor Yellow
    if ($path.StartsWith($Target, "OrdinalIgnoreCase")) {
        Write-Host "  这就是本目录的内核，直接打开窗口就行" -ForegroundColor Green
        if (-not $NoStart) { Start-Process -FilePath $exe -WorkingDirectory $Target }
        exit 0
    }
    if (-not $ForceClose) {
        $ans = Read-Host "  要关掉它并启动个人版吗？(y/N)"
        if ($ans -notmatch "^(y|Y|yes|YES)$") { Write-Host "  已取消"; exit 2 }
    }
    $others = Get-CimInstance Win32_Process | Where-Object {
        $_.ExecutablePath -and ($_.ExecutablePath -like "*WhaleGirl*" -or $_.ExecutablePath -like "*whale-personal*") -and $_.ExecutablePath -notlike (Join-Path $Target "*")
    }
    foreach ($p in $others) {
        Write-Host "  停止 pid=$($p.ProcessId) $($p.Name)"
        Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue
    }
    for ($i = 0; $i -lt 20 -and (Get-PortOwner); $i++) { Start-Sleep -Milliseconds 500 }
    if (Get-PortOwner) { throw "端口 8787 还被占着，请手动结束占用进程" }
}

if (-not $NoStart) {
    Start-Process -FilePath $exe -ArgumentList "--autostart" -WorkingDirectory $Target
    Write-Host "  已拉起启动器（--autostart），等待内核…"
    $ok = $false
    for ($i = 0; $i -lt 40; $i++) {
        Start-Sleep -Seconds 2
        if (Get-PortOwner) { $ok = $true; break }
    }
    if ($ok) { Write-Host "  [成功] 8787 已就绪" -ForegroundColor Green } else { Write-Host "  [失败] 60 秒内内核没起来，去看 data\launcher.log" -ForegroundColor Red; exit 1 }
}