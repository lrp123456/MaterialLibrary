# Offline packaging status check
param([string]$ConfigPath = "")
$ErrorActionPreference = "Continue"
if (-not $ConfigPath) { $ConfigPath = Join-Path $PSScriptRoot "offline-config.json" }
if (-not (Test-Path $ConfigPath)) {
  Write-Host "MISSING config: $ConfigPath"
  exit 1
}
$cfg = Get-Content $ConfigPath -Raw -Encoding UTF8 | ConvertFrom-Json
$items = @(
  @{ Name = "Android SDK platform-tools"; Path = (Join-Path $cfg.androidSdkRoot "platform-tools\adb.exe") },
  @{ Name = "Android SDK platform 34"; Path = (Join-Path $cfg.androidSdkRoot "platforms\android-34\android.jar") },
  @{ Name = "Build-tools 34"; Path = (Join-Path $cfg.androidSdkRoot "build-tools\34.0.0\aapt2.exe") },
  @{ Name = "JDK (Corretto)"; Path = (Join-Path $cfg.javaHome "bin\java.exe") },
  @{ Name = "HBuilderX cli"; Path = $cfg.hbx },
  @{ Name = "uni project"; Path = $cfg.uniProject },
  @{ Name = "offline project"; Path = (Join-Path $cfg.offlineProject "app\build.gradle") },
  @{ Name = "offline SDK lib.5plus"; Path = (Join-Path $cfg.offlineProject "app\libs\lib.5plus.base-release.aar") },
  @{ Name = "uniapp-v8 aar"; Path = (Join-Path $cfg.offlineProject "app\libs\uniapp-v8-release.aar") },
  @{ Name = "dcloud_control.xml"; Path = (Join-Path $cfg.offlineProject "app\src\main\assets\data\dcloud_control.xml") },
  @{ Name = "www present"; Path = (Join-Path $cfg.offlineProject ("app\src\main\assets\apps\" + $cfg.appId + "\www\app-service.js")) },
  @{ Name = "localinfer jar"; Path = (Join-Path $cfg.offlineProject "app\libs\uni-local-infer.jar") },
  @{ Name = "localinfer so"; Path = (Join-Path $cfg.offlineProject "app\src\main\jniLibs\arm64-v8a\liblocalinfer.so") }
)

Write-Host "=== Offline Pack Readiness ==="
Write-Host "packageName : $($cfg.packageName)"
Write-Host "appId       : $($cfg.appId)"
Write-Host "appKey      : $(if ([string]::IsNullOrWhiteSpace($cfg.appKey)) { '<EMPTY>' } else { $cfg.appKey })"
Write-Host "SHA1        : $($cfg.keystoreSha1)"
Write-Host ""
$ok = 0; $miss = 0
foreach ($i in $items) {
  $exists = Test-Path $i.Path
  $mark = if ($exists) { "[OK]  " } else { "[MISS]" }
  if ($exists) { $ok++ } else { $miss++ }
  Write-Host ("{0} {1}`n       {2}" -f $mark, $i.Name, $i.Path)
}
Write-Host ""
Write-Host "OK=$ok  MISSING=$miss"
if ([string]::IsNullOrWhiteSpace($cfg.appKey)) {
  Write-Host "ACTION: 申请 AppKey — https://dev.dcloud.net.cn"
  Write-Host "  appid=$($cfg.appId)  package=$($cfg.packageName)  SHA1=$($cfg.keystoreSha1)"
}
if (-not (Test-Path (Join-Path $cfg.offlineProject "app\libs\lib.5plus.base-release.aar"))) {
  Write-Host "ACTION: 下载 Android 离线 SDK（百度网盘）并解压，再运行 import-offline-sdk.ps1"
  Write-Host "  正式版: https://nativesupport.dcloud.net.cn/AppDocs/download/android.html"
  Write-Host "  建议解压到: $($cfg.offlineSdkExtractDir)"
}
if ($miss -gt 0) { exit 2 } else { exit 0 }
