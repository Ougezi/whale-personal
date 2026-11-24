# 鲸鲸 · 个人版：给 WhaleLauncher.exe 做本地代码签名（可选）
#   powershell -ExecutionPolicy Bypass -File scripts\personal\sign-launcher.ps1 -Exe dist\whale-personal\WhaleLauncher.exe
# 说明：
#  1) 用本机自签名证书（CN=Ougezi Whale）；只在信任这张证书的电脑上有效；
#  2) 需要把 data\certs\whale-codesign.cer 导入「受信任的根证书颁发机构」+「受信任的发布者」；
#     Root 导入时 Windows 会弹一次确认（这是系统行为，脚本不跳过）。
#  3) 证书私钥在 CurrentUser\My，导出 .pfx 请自行保管，不要提交仓库。
param(
    [Parameter(Mandatory = $true)][string]$Exe,
    [string]$Subject = "CN=Ougezi Whale, O=Ougezi"
)
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
if (-not (Test-Path $Exe)) { throw "找不到 $Exe" }

function Get-SignTool {
    $candidates = @()
    $candidates += (Get-Command signtool.exe -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source)
    $candidates += Get-ChildItem "$env:USERPROFILE\.nuget\packages\microsoft.windows.sdk.buildtools" -Filter signtool.exe -Recurse -ErrorAction SilentlyContinue |
        Where-Object { $_.FullName -match '\\x64\\' } | Select-Object -ExpandProperty FullName
    $found = $candidates | Where-Object { $_ } | Select-Object -First 1
    if (-not $found) {
        Write-Host "没有 signtool：先执行 dotnet restore（依赖 Microsoft.Windows.SDK.BuildTools），或安装 Windows SDK" -ForegroundColor Yellow
        exit 1
    }
    return $found
}

$cert = Get-ChildItem Cert:\CurrentUser\My -CodeSigningCert | Where-Object { $_.Subject -eq $Subject } | Select-Object -First 1
if (-not $cert) {
    Write-Host "创建自签名证书 $Subject" -ForegroundColor Cyan
    $cert = New-SelfSignedCertificate -Type CodeSigningCert -Subject $Subject -CertStoreLocation Cert:\CurrentUser\My `
        -KeyUsage DigitalSignature -KeyExportPolicy Exportable -NotAfter (Get-Date).AddYears(5) `
        -TextExtension @('2.5.29.37={text}1.3.6.1.5.5.7.3.3')
}
New-Item -ItemType Directory -Force -Path (Join-Path $root "launcher\certs") | Out-Null
$cer = Join-Path $root "launcher\certs\whale-codesign.cer"
Export-Certificate -Cert $cert -FilePath $cer -Type CERT | Out-Null
Write-Host "证书已导出：$cer"
Write-Host "  Thumbprint=$($cert.Thumbprint)"
Write-Host "  受信任发布者（当前用户）："
try { Import-Certificate -FilePath $cer -CertStoreLocation Cert:\CurrentUser\TrustedPublisher -ErrorAction Stop | Out-Null; Write-Host "    已导入" } catch { Write-Host "    导入失败：$($_.Exception.Message)" }
Write-Host "  受信任的根证书（需要你点一次 Windows 确认）："
Write-Host "    certutil -user -addstore -f Root `"$cer`""

$signtool = Get-SignTool
Write-Host "签名：$Exe" -ForegroundColor Cyan
& $signtool sign /sha1 $cert.Thumbprint /s My /fd SHA256 /v $Exe
Write-Host "验证（Root 未信任时会报 chain 不完整，属预期）："
& $signtool verify /pa /v $Exe
Write-Host "签名完成：$Exe" -ForegroundColor Green
