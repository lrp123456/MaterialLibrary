# Import DCloud Android offline SDK AAR/resources into android-offline project
# Default: curated minimal set (avoid ad-sdk manifest conflicts)
# Use -All to copy every AAR from SDK/libs
param(
  [string]$SdkDir = "",
  [string]$ConfigPath = "",
  [switch]$All
)
$ErrorActionPreference = "Stop"
$scripts = $PSScriptRoot
if (-not $ConfigPath) { $ConfigPath = Join-Path $scripts "offline-config.json" }
$cfg = Get-Content $ConfigPath -Raw -Encoding UTF8 | ConvertFrom-Json
$proj = $cfg.offlineProject
$app = Join-Path $proj "app"
$libs = Join-Path $app "libs"
$assets = Join-Path $app "src\main\assets"
$assetsData = Join-Path $assets "data"
$resSrc = Join-Path $app "src\main\res"
$jni = Join-Path $app "src\main\jniLibs"

foreach ($d in @($libs, $assets, $assetsData, $jni, (Join-Path $jni "arm64-v8a"), (Join-Path $jni "armeabi-v7a"))) {
  New-Item -ItemType Directory -Force -Path $d | Out-Null
}

if (-not $SdkDir) {
  $candidates = @(
    $cfg.offlineSdkExtractDir,
    "C:\baidunetdiskdownload\最新版\5.26\Android-SDK@5.26.82680_20260914",
    "C:\Users\lrp\Downloads\DCloud-Android-Offline-SDK\Android-SDK@5.26.82680_20260914",
    "C:\Users\lrp\Downloads\DCloud-Android-Offline-SDK",
    "C:\Users\lrp\Downloads\Android-SDK"
  )
  foreach ($c in $candidates) {
    if (Test-Path (Join-Path $c "SDK")) { $SdkDir = $c; break }
    if (Test-Path (Join-Path $c "libs")) { $SdkDir = $c; break }
  }
  if (-not $SdkDir) {
    throw "未找到已解压的离线 SDK。请解压到:`n  $($cfg.offlineSdkExtractDir)`n  再重跑本脚本。"
  }
}

Write-Host "[import-offline-sdk] SdkDir=$SdkDir  All=$All"
$sdkRoot = $SdkDir
if (Test-Path (Join-Path $SdkDir "SDK")) { $sdkRoot = Join-Path $SdkDir "SDK" }
Write-Host "  sdkRoot=$sdkRoot"

$aarDir = Join-Path $sdkRoot "libs"
if (-not (Test-Path $aarDir)) { $aarDir = $sdkRoot }
$aars = Get-ChildItem $aarDir -Recurse -Include *.aar, *.jar -ErrorAction SilentlyContinue
if (-not $aars) { throw "SDK/libs 下没有 aar/jar: $aarDir" }

# Curated: official Integrate-AS minimal + VideoPlayer + custom native plugin + common uni runtime bits
$keepPatterns = @(
  'lib.5plus.base-release.aar',
  'uniapp-v8-release.aar',
  'android-gif-drawable',
  'oaid_sdk_',
  'install-apk-release.aar',
  'breakpad-build-release.aar',
  'weex_videoplayer-release.aar',
  'weex_webview-x5-release.aar',
  'webview-x5-release.aar',
  'media-release.aar',
  'audio-mp3aac-release.aar',
  'sqlite-release.aar',
  'uni-storage-release.aar',
  'uni-network-release.aar',
  'uni-prompt-release.aar',
  'uni-exit-release.aar',
  'uni-getSystemInfo-release.aar',
  'uni-getAppBaseInfo-release.aar',
  'uni-getDeviceInfo-release.aar',
  'uni-getNetworkType-release.aar',
  'uni-getAppAuthorizeSetting-release.aar',
  'uni-openAppAuthorizeSetting-release.aar',
  'uni-installApk-release.aar',
  'uni-chooseMedia-release.aar',
  'statistic-release.aar',
  'debug-server-release.aar'
)

Write-Host "[1] 同步 libs（清理旧文件后按需复制）"
# wipe aar/jar except we re-copy; keep folder
Get-ChildItem $libs -Include *.aar, *.jar -Recurse -ErrorAction SilentlyContinue | Remove-Item -Force -ErrorAction SilentlyContinue
Get-ChildItem $libs -File -ErrorAction SilentlyContinue | Where-Object { $_.Extension -in '.aar','.jar' } | Remove-Item -Force -ErrorAction SilentlyContinue

$copied = 0
$names = @()
foreach ($a in $aars) {
  if ($a.FullName -match 'iOS|\.dsym|/mac/|/osx/') { continue }
  if (-not $All) {
    $hit = $false
    foreach ($p in $keepPatterns) {
      if ($a.Name -like "*$p*") { $hit = $true; break }
    }
    if (-not $hit) { continue }
  }
  Copy-Item $a.FullName (Join-Path $libs $a.Name) -Force
  $copied++
  $names += $a.Name
}
Write-Host "  copied=$copied mode=$(if ($All) { 'ALL' } else { 'CURATED' })"
$names | Sort-Object | ForEach-Object { Write-Host "    $_" }

$required = @('lib.5plus.base-release.aar', 'uniapp-v8-release.aar')
$missing = @()
foreach ($r in $required) {
  if (-not (Test-Path (Join-Path $libs $r))) { $missing += $r }
}
if ($missing.Count) { throw "基础库缺失: $($missing -join ', ')" }

Write-Host "[2] 复制 SDK assets/data"
$dataSrc = Join-Path $sdkRoot "assets\data"
if (-not (Test-Path $dataSrc)) {
  $dataSrc = Get-ChildItem $sdkRoot -Recurse -Directory -Filter "data" -ErrorAction SilentlyContinue |
    Where-Object { Test-Path (Join-Path $_.FullName "dcloud_control.xml") } |
    Select-Object -First 1 -ExpandProperty FullName
}
if (-not $dataSrc) { throw "未找到 SDK assets/data" }
if (Test-Path $assetsData) { Remove-Item $assetsData -Recurse -Force }
Copy-Item $dataSrc $assetsData -Recurse -Force
Write-Host "  data <= $dataSrc"

Write-Host "[3] 复制 SDK res"
$sdkRes = Join-Path $sdkRoot "res"
if (Test-Path $sdkRes) {
  Get-ChildItem $sdkRes -Directory | ForEach-Object {
    $dst = Join-Path $resSrc $_.Name
    New-Item -ItemType Directory -Force -Path $dst | Out-Null
    Copy-Item (Join-Path $_.FullName "*") $dst -Recurse -Force
  }
  Write-Host "  res merged"
}

Write-Host "[4] 同步 dcloud_control.xml appid"
$ctrl = Join-Path $assetsData "dcloud_control.xml"
if (Test-Path $ctrl) {
  $content = Get-Content $ctrl -Raw
  $appId = $cfg.appId
  if ($content -match 'appid="[^"]+"') {
    $content = $content -replace 'appid="[^"]+"', "appid=`"$appId`""
  }
  $ok = $false
  for ($try = 1; $try -le 10 -and -not $ok; $try++) {
    try { Set-Content -Path $ctrl -Value $content -Encoding UTF8; $ok = $true }
    catch { Write-Host "  control.xml busy, retry $try/10..."; Start-Sleep -Seconds 2 }
  }
  if (-not $ok) { throw "cannot write dcloud_control.xml (locked)" }
  Write-Host "  appid => $appId"
  Get-Content $ctrl
}

Write-Host "[5] 同步 uni-local-infer"
$plug = $cfg.nativePlugin
$jar = Join-Path $plug "android\libs\uni-local-infer.jar"
if (Test-Path $jar) { Copy-Item $jar $libs -Force; Write-Host "  jar" }
foreach ($abi in @("arm64-v8a", "armeabi-v7a")) {
  $so = Join-Path $plug "android\libs\$abi\liblocalinfer.so"
  if (Test-Path $so) { Copy-Item $so (Join-Path $jni $abi) -Force; Write-Host "  so $abi" }
}
$modelAssets = Join-Path $plug "android\assets\local-models"
if (Test-Path $modelAssets) {
  $dst = Join-Path $assets "local-models"
  if (Test-Path $dst) { Remove-Item $dst -Recurse -Force }
  Copy-Item $modelAssets $dst -Recurse -Force
  Write-Host "  models"
}

Write-Host "[ok] import complete libs=$((Get-ChildItem $libs -File -ErrorAction SilentlyContinue).Count)"
