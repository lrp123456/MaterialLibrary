# Cloud pack APK then ADB install (not push)
param(
  [string]$Serial = "",
  [string]$PackageName = "lrp.aibum",
  [string]$CertType = "3",
  [switch]$SkipBuild,
  [switch]$PushModels,
  [switch]$BumpVersion,
  [switch]$NoPrompt
)
$ErrorActionPreference = "Stop"
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}
$scripts = $PSScriptRoot
$root = Split-Path -Parent $scripts
Set-Location $root

Write-Host "======== [1/2] 云打包自定义基座 APK ========"
$packArgs = @("-PackageName", $PackageName, "-CertType", $CertType)
if ($BumpVersion) { $packArgs += "-BumpVersion" }
if ($NoPrompt) { $packArgs += "-NoPrompt" }
powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $scripts "pack-custom-base.ps1") @packArgs
if ($LASTEXITCODE -ne 0) { throw "pack-custom-base 失败 exit=$LASTEXITCODE" }

$apk = Get-ChildItem (Join-Path $root "dist\release\apk") -Filter "*.apk" -ErrorAction SilentlyContinue |
  Where-Object { $_.Name -like "album-sync-custombase-*.apk" -or $_.Name -like "__UNI__*.apk" -or $_.Name -like "album-sync-*.apk" } |
  Sort-Object LastWriteTime -Descending |
  Select-Object -First 1
if (-not $apk) { throw "未找到云打包 APK（dist\release\apk）" }
Write-Host "产物 $($apk.FullName)  $([math]::Round($apk.Length/1MB,2)) MB"

Write-Host ""
Write-Host "======== [2/2] ADB 安装到设备 ========"
$adbArgs = @{ Apk = $apk.FullName; PackageName = $PackageName }
if ($Serial) { $adbArgs["Serial"] = $Serial }
if ($PushModels) { $adbArgs["PushModels"] = $true }
powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $scripts "adb-install.ps1") @adbArgs
if ($LASTEXITCODE -ne 0) { throw "ADB 安装失败 exit=$LASTEXITCODE" }

Write-Host ""
Write-Host "完成：云打包 APK 已 ADB 安装到手机（未推更新通道）。"
Write-Host "  $($apk.Name)"
