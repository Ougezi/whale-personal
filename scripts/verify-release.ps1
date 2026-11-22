# 发布清单一致性校验：便携目录 / 完整包 zip / 安装包 三者关键文件必须一致。
#
#   powershell -File scripts\verify-release.ps1 -Portable dist\whale-personal -Zip release\whale-girl-4.6.0-full.zip
#   powershell -File scripts\verify-release.ps1 -Portable dist\whale-personal -Setup release\whale-girl-4.6.0-setup.exe -Manifest release-manifest.json
#
# 只读：不修改任何产物。校验失败退出码 1。
param(
    [Parameter(Mandatory = $true)][string]$Portable,
    [string]$Zip = '',
    [string]$Setup = '',
    [string]$Manifest = '',
    [string]$Sums = ''
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem

function Get-Sha([string]$path) {
    (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLower()
}

# 关键文件：换掉任何一个都说明包不是同一份
$keys = @(
    'WhaleLauncher.exe',
    'server.js',
    'package.json',
    'release-manifest.json',
    'bridge/douyin_agent.py',
    'bridge/selfcheck.py',
    'src/core/selfRules.js',
    'src/persona/prompt.js'
)

$fail = 0
function Bad($msg) { Write-Host "  [x] $msg" -ForegroundColor Red; $script:fail++ }
function Ok($msg) { Write-Host "  [ok] $msg" -ForegroundColor Green }

if (-not (Test-Path -LiteralPath $Portable)) { throw "便携目录不存在：$Portable" }
$portableRoot = (Resolve-Path -LiteralPath $Portable).Path
$base = @{}
foreach ($k in $keys) {
    $p = Join-Path $portableRoot ($k -replace '/', '\')
    if (-not (Test-Path -LiteralPath $p)) { Bad "便携目录缺少 $k"; continue }
    $base[$k] = Get-Sha $p
}
if ($base.Count -eq $keys.Count) { Ok "便携目录关键文件齐全（$($keys.Count) 个）" }

if ($Zip) {
    if (-not (Test-Path -LiteralPath $Zip)) { throw "zip 不存在：$Zip" }
    $zipPath = (Resolve-Path -LiteralPath $Zip).Path
    $z = [IO.Compression.ZipFile]::OpenRead($zipPath)
    try {
        foreach ($k in $keys) {
            if (-not $base.ContainsKey($k)) { continue }
            $entry = $z.Entries | Where-Object {
                ($_.FullName -replace '\\', '/') -eq $k -or ($_.FullName -replace '\\', '/').EndsWith('/' + $k)
            } | Select-Object -First 1
            if (-not $entry) { Bad "zip 缺少 $k"; continue }
            $ms = New-Object IO.MemoryStream
            try {
                $s = $entry.Open()
                $s.CopyTo($ms)
                $s.Dispose()
                $hash = ([BitConverter]::ToString([Security.Cryptography.SHA256]::Create().ComputeHash($ms.ToArray())) -replace '-', '').ToLower()
                if ($hash -ne $base[$k]) { Bad "zip 里 $k 与便携目录不一致" }
                else { Ok "zip：$k" }
            } finally { $ms.Dispose() }
        }
    } finally { $z.Dispose() }
}

if ($Setup) {
    if (-not (Test-Path -LiteralPath $Setup)) { throw "安装包不存在：$Setup" }
    $setupHash = Get-Sha $Setup
    if ($Sums -and (Test-Path -LiteralPath $Sums)) {
        $name = Split-Path -Leaf $Setup
        $line = Get-Content -LiteralPath $Sums | Where-Object { $_ -match [regex]::Escape($name) } | Select-Object -First 1
        if (-not $line) { Bad "SHA256SUMS 里没有 $name" }
        elseif ($line.TrimStart().StartsWith($setupHash)) { Ok "安装包 SHA256 与清单一致" }
        else { Bad "安装包 SHA256 与清单不一致" }
    } else {
        Ok "安装包 SHA256：$setupHash"
    }
}

if ($Manifest -and $base.ContainsKey('package.json')) {
    if (-not (Test-Path -LiteralPath $Manifest)) { throw "清单不存在：$Manifest" }
    $m = Get-Content -LiteralPath $Manifest -Raw -Encoding UTF8 | ConvertFrom-Json
    $pkg = Get-Content -LiteralPath (Join-Path $portableRoot 'package.json') -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($m.latest -and $pkg.version -and ($m.latest -ne $pkg.version)) { Bad "清单 latest=$($m.latest) 与包版本 $($pkg.version) 不一致" }
    else { Ok "清单版本与包版本一致（$($pkg.version)）" }
}

if ($fail) { Write-Host "`n一致性校验失败：$fail 项" -ForegroundColor Red; exit 1 }
Write-Host "`n一致性校验通过" -ForegroundColor Green
