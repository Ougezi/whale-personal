# 鲸鲸 · 个人版：一条命令完成「信任证书 + 代码签名 + 打包校验」
#   powershell -ExecutionPolicy Bypass -File scripts\personal\sign-and-release.ps1
#   powershell ... -Exe dist\whale-personal\WhaleLauncher.exe -NoRestart
# 说明：
#  - 需要管理员（把自签名证书装进本机「受信任的根证书颁发机构」和「受信任的发布者」）；
#  - 证书只在装过它的电脑上算「受信任发布者」；别的电脑要导入 launcher\certs\whale-codesign.cer；
#  - 启动器正在运行会锁文件，脚本会先停掉本目录的 WhaleLauncher 再签名（-NoRestart 可不让它自动回来）。
param(
    [string]$Exe = "",
    [string]$Subject = "CN=Ougezi Whale, O=Ougezi",
    [switch]$NoRestart,
    [switch]$SkipRootInstall
)
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
if (-not $Exe) { $Exe = Join-Path $root "dist\whale-personal\WhaleLauncher.exe" }
if (-not (Test-Path $Exe)) { throw "找不到 $Exe" }
$Exe = (Resolve-Path $Exe).Path
$targetDir = Split-Path -Parent $Exe

function Assert-Admin {
    $isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
    if (-not $isAdmin) { throw "需要管理员权限：把自签名证书装进本机受信任根（右键以管理员身份运行 PowerShell）" }
}

function Get-SignTool {
    $found = Get-Command signtool.exe -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source
    if (-not $found) {
        $found = Get-ChildItem "$env:USERPROFILE\.nuget\packages\microsoft.windows.sdk.buildtools" -Filter signtool.exe -Recurse -ErrorAction SilentlyContinue |
            Where-Object { $_.FullName -match '\\x64\\' } | Select-Object -First 1 -ExpandProperty FullName
    }
    if (-not $found) { throw "找不到 signtool.exe：先 dotnet restore 依赖 Microsoft.Windows.SDK.BuildTools，或安装 Windows SDK" }
    return $found
}

Assert-Admin
$signtool = Get-SignTool
Write-Host "== 1/5 准备证书 ==" -ForegroundColor Cyan
$cert = Get-ChildItem Cert:\CurrentUser\My -CodeSigningCert | Where-Object { $_.Subject -eq $Subject } | Select-Object -First 1
if (-not $cert) {
    $cert = New-SelfSignedCertificate -Type CodeSigningCert -Subject $Subject -CertStoreLocation Cert:\CurrentUser\My `
        -KeyUsage DigitalSignature -KeyExportPolicy Exportable -NotAfter (Get-Date).AddYears(5) `
        -TextExtension @('2.5.29.37={text}1.3.6.1.5.5.7.3.3')
    Write-Host "  已创建 $Subject"
}
$certDir = Join-Path $root "launcher\certs"
New-Item -ItemType Directory -Force -Path $certDir | Out-Null
$cer = Join-Path $certDir "whale-codesign.cer"
Export-Certificate -Cert $cert -FilePath $cer -Type CERT | Out-Null
Write-Host "  证书: $cer (Thumbprint $($cert.Thumbprint))"

Write-Host "== 2/5 装进本机受信任存储（管理员）==" -ForegroundColor Cyan
foreach ($store in @('Root', 'TrustedPublisher')) {
    if ($store -eq 'Root' -and $SkipRootInstall) { Write-Host "  跳过 Root（-SkipRootInstall）"; continue }
    & certutil -addstore -f $store $cer | Out-Null
    Write-Host "  $store 已导入"
}

Write-Host "== 3/5 停止占用文件的启动器 ==" -ForegroundColor Cyan
Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -and $_.ExecutablePath.Equals($Exe, 'OrdinalIgnoreCase') } | ForEach-Object {
    Write-Host "  停止 pid=$($_.ProcessId)"
    Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
}
Start-Sleep -Seconds 2

Write-Host "== 4/5 签名 + 校验 ==" -ForegroundColor Cyan
& $signtool sign /sha1 $cert.Thumbprint /s My /fd SHA256 /v $Exe
& $signtool verify /pa /v $Exe
if ($LASTEXITCODE -ne 0) { throw "签名校验失败（$LASTEXITCODE）" }
$hash = (Get-FileHash -Algorithm SHA256 $Exe).Hash
Write-Host "  签名通过，SHA256=$hash"

Write-Host "== 5/5 重打增量包并校验包内 exe 签名 ==" -ForegroundColor Cyan
$zipScript = Join-Path $PSScriptRoot 'make-update-zip.ps1'
& powershell -NoProfile -ExecutionPolicy Bypass -File $zipScript | Out-Host
$version = (Select-String -Path (Join-Path $root 'package.json') -Pattern '"version"\s*:\s*"([^"]+)"' | Select-Object -First 1).Matches[0].Groups[1].Value
if (-not $version) { throw '读不到 package.json 的 version' }
$zip = Join-Path $root ("dist\whale-personal-update-" + $version + ".zip")
if (-not (Test-Path $zip)) { throw "没找到刚打出来的包：$zip" }
$tmp = Join-Path $env:TEMP ("whale-signed-" + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force -Path $tmp | Out-Null
try {
    Expand-Archive -LiteralPath $zip -DestinationPath $tmp -Force
    $inner = Get-ChildItem $tmp -Recurse -Filter WhaleLauncher.exe | Select-Object -First 1
    if (-not $inner) { throw "包内没有 WhaleLauncher.exe" }
    & $signtool verify /pa /q $inner.FullName
    if ($LASTEXITCODE -ne 0) { throw "包内 exe 签名校验失败（$LASTEXITCODE）" }
    Write-Host "  包内 exe 签名通过：$($inner.FullName)"
    Write-Host "  包: $zip ($([math]::Round((Get-Item $zip).Length/1MB,2)) MB)"
} finally {
    Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
}

if (-not $NoRestart) {
    Write-Host "== 重启启动器 ==" -ForegroundColor Cyan
    Start-Process -FilePath $Exe -ArgumentList '--autostart' | Out-Null
    Write-Host "  已重启（--autostart）"
}
Write-Host "完成：证书可信任 + 签名通过 + 包已校验" -ForegroundColor Green
