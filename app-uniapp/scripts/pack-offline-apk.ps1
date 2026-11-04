# Offline APK pack (DCloud Offline SDK + Gradle), per-model source switching.
# Usage:
#   pack-offline-apk.ps1 -Model o            # pack with Oxbow client source
#   pack-offline-apk.ps1 -Model base         # pack with src_backup baseline
#   pack-offline-apk.ps1 -Model o -Install -Serial 127.0.0.1:21503
#   pack-offline-apk.ps1 -Model o -SkipImport   # skip SDK/plugin re-import
param(
  [string]$Model = "base",
  [switch]$Install,
  [string]$Serial = "",
  [switch]$SkipBuild,
  [switch]$SkipImport,
  [switch]$BumpVersion,
  [switch]$NoPrompt,
  [string]$ConfigPath = ""
)
$ErrorActionPreference = "Stop"

# 兼容从 PowerShell 7 环境（如 service-hub 经 pwsh 启动、MSIX 安装器把 PS7 模块目录
# 写入 PSModulePath 最前）拉起本脚本的情况：WPS 5.1 会优先发现并加载 7.0.0.0 的
# Microsoft.PowerShell.Utility（.NET Core 编译，cmdlet 在 5.1 里不导出），表现为
# Get-FileHash 等命令"无法识别"。此处把模块路径规范回 5.1 规范路径，后续自动模块
# 发现及本脚本派生的所有嵌套 powershell 子进程均使用干净环境。
if ($PSVersionTable.PSVersion.Major -lt 6) {
  $cleanModulePath = @(
    (Join-Path $HOME "Documents\WindowsPowerShell\Modules"),
    "C:\Program Files\WindowsPowerShell\Modules",
    (Join-Path $env:WINDIR "System32\WindowsPowerShell\v1.0\Modules")
  ) | Where-Object { Test-Path $_ } | Select-Object -Unique
  $env:PSModulePath = [string]::Join(";", $cleanModulePath)
}

$scripts = $PSScriptRoot
$root = Split-Path -Parent $scripts
if (-not $ConfigPath) { $ConfigPath = Join-Path $scripts "offline-config.json" }
$cfg = Get-Content $ConfigPath -Raw -Encoding UTF8 | ConvertFrom-Json

$srcDir = Join-Path $cfg.uniProject "src"
$bakDir = Join-Path $cfg.uniProject "src_backup"
$wwwOut = Join-Path $cfg.uniProject "dist\build\app"
$offlineApp = Join-Path $cfg.offlineProject "app"
$assetsApps = Join-Path $offlineApp "src\main\assets\apps"
$wwwDst = Join-Path (Join-Path $assetsApps $cfg.appId) "www"
$uniCmd = Join-Path $cfg.uniProject "node_modules\.bin\uni.cmd"
$gradle = $cfg.gradleBin
if (-not ($gradle -and (Test-Path $gradle))) { $gradle = Join-Path $cfg.androidSdkRoot "..\gradle-8.9\bin\gradle.bat" }
$env:JAVA_HOME = $cfg.javaHome
$env:Path = "$($cfg.javaHome)\bin;$env:Path"

$portMap = @{ o = 31021; m = 31022; n = 31023; l = 31024 }
$nameMap = @{ o = "Oxbow"; m = "Marten"; n = "Nodule"; l = "Lapis" }
$code = "$Model".Trim().ToLowerInvariant()

function Copy-Tree([string]$from, [string]$to) {
  New-Item -ItemType Directory -Force -Path $to | Out-Null
  Copy-Item (Join-Path $from "*") $to -Recurse -Force
}

function Get-Md5Hex([string]$path) {
  # 不依赖 Get-FileHash：被 PS7 模块劫持时该 cmdlet 可能缺失，.NET MD5 始终可用
  $hasher = [System.Security.Cryptography.MD5]::Create()
  try {
    $fs = [System.IO.File]::OpenRead($path)
    try { return ([BitConverter]::ToString($hasher.ComputeHash($fs))).Replace("-", "") }
    finally { $fs.Dispose() }
  } finally { $hasher.Dispose() }
}

function Set-FileLocked([string]$path, [string]$value, [switch]$NoNewline) {
  $ok = $false
  for ($i = 1; $i -le 15 -and -not $ok; $i++) {
    try {
      if ($NoNewline) { Set-Content -Path $path -Value $value -Encoding UTF8 -NoNewline }
      else { Set-Content -Path $path -Value $value -Encoding UTF8 }
      $ok = $true
    } catch {
      Write-Host "  write busy ($([System.IO.Path]::GetFileName($path))), retry $i/15..."
      Start-Sleep -Milliseconds 1200
    }
  }
  if (-not $ok) { throw "cannot write (locked): $path" }
}

function Test-SdkExtractPresent {
  # 仓外 DCloud 离线 SDK 解压目录是机器级工具位置（非项目代码）。
  # 自包含要求：该目录被删除时，只要仓内已入库的 SDK 副本锚点齐全，构建照常进行。
  foreach ($c in @($cfg.offlineSdkExtractDir)) {
    if (-not $c) { continue }
    if (Test-Path (Join-Path $c "SDK")) { return $true }
    if (Test-Path (Join-Path $c "libs")) { return $true }
  }
  return $false
}

function Test-CommittedSdkAnchors {
  $anchors = @(
    (Join-Path $offlineApp "libs\uniapp-v8-release.aar"),
    (Join-Path $offlineApp "libs\lib.5plus.base-release.aar"),
    (Join-Path $offlineApp "libs\uni-local-infer.jar"),
    (Join-Path $offlineApp "src\main\assets\data\dcloud_control.xml"),
    (Join-Path $offlineApp "src\main\jniLibs\arm64-v8a\liblocalinfer.so"),
    (Join-Path $offlineApp "src\main\jniLibs\armeabi-v7a\liblocalinfer.so")
  )
  foreach ($a in $anchors) { if (-not (Test-Path $a)) { Write-Host "  [anchor miss] $a" -ForegroundColor Yellow; return $false } }
  return $true
}

function Restore-SdkAssets {
  Write-Host "==== re-import offline SDK / native plugin (repair zeroed files) ====" -ForegroundColor Cyan
  if (Test-SdkExtractPresent) {
    powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $scripts "import-offline-sdk.ps1") -ConfigPath $ConfigPath
    if ($LASTEXITCODE -ne 0) { throw "import-offline-sdk failed" }
  } else {
    Write-Host "[warn] 仓外离线 SDK 解压目录不存在（$($cfg.offlineSdkExtractDir)）" -ForegroundColor Yellow
    Write-Host "       跳过 SDK re-import，改用仓内 android-offline 已入库副本。" -ForegroundColor Yellow
    if (-not (Test-CommittedSdkAnchors)) {
      throw "仓内 SDK 副本锚点不完整，且仓外离线 SDK 缺失。请恢复解压目录后重跑 import-offline-sdk.ps1。"
    }
    Write-Host "  [ok] committed SDK anchors verified (AAR / data / 双 ABI .so)" -ForegroundColor Green
  }
  $plug = $cfg.nativePlugin
  $jni = Join-Path $offlineApp "src\main\jniLibs"
  $libsDir = Join-Path $offlineApp "libs"
  Copy-Item (Join-Path $plug "android\libs\uni-local-infer.jar") $libsDir -Force
  foreach ($abi in @("arm64-v8a", "armeabi-v7a")) {
    $so = Join-Path $plug "android\libs\$abi\liblocalinfer.so"
    if (Test-Path $so) {
      New-Item -ItemType Directory -Force -Path (Join-Path $jni $abi) | Out-Null
      Copy-Item $so (Join-Path $jni $abi) -Force
    }
  }
  $good = $cfg.localModelsGoodDir
  $dstModels = Join-Path $offlineApp "src\main\assets\local-models"
  if (Test-Path $good) {
    if (Test-Path $dstModels) { Remove-Item $dstModels -Recurse -Force }
    New-Item -ItemType Directory -Force -Path $dstModels | Out-Null
    if (Test-Path (Join-Path $good "device-layout\edge_sam_mobile")) {
      Copy-Tree (Join-Path $good "device-layout\edge_sam_mobile") (Join-Path $dstModels "edge_sam_mobile")
    }
    foreach ($f in @("edge_sam_encoder.bin", "edge_sam_decoder.bin")) {
      if (Test-Path (Join-Path $good $f)) { New-Item -ItemType Directory -Force -Path (Join-Path $dstModels "edge_sam_mobile") | Out-Null
        Copy-Item (Join-Path $good $f) (Join-Path $dstModels "edge_sam_mobile") -Force }
    }
    if (Test-Path (Join-Path $good "realesrgan_x4_ncnn")) {
      Copy-Tree (Join-Path $good "realesrgan_x4_ncnn") (Join-Path $dstModels "realesrgan_x4_ncnn")
    }
  }
  Write-Host "[ok] SDK/plugin assets ready" -ForegroundColor Green
}

function Test-StubFile([string]$path) {
  if (-not (Test-Path $path)) { return $true }
  $t = Get-Content $path -Raw -ErrorAction SilentlyContinue
  if (-not $t) { return $true }
  if ($t.Length -lt 400) { return $true }
  return [bool]($t -match 'hl-stub|atp-stub|ts-stub|源文件曾损坏|可编译占位|prior-runtime\.js|_comp_def|import \* as vue')
}

function Test-DecompiledFile([string]$path) {
  if (-not (Test-Path $path)) { return $false }
  $head = (Get-Content $path -TotalCount 3 -ErrorAction SilentlyContinue) -join ' '
  return [bool]($head -match 'prior-runtime\.js|_comp_def|import \* as vue|formatAppLog')
}

function Backup-SourceMeta {
  # Snapshot files Prepare-Source may rewrite so we can restore after pack.
  $script:srcMetaBak = @()
  foreach ($rel in @("common\Constants.js", "manifest.json")) {
    $full = Join-Path $srcDir $rel
    if (Test-Path $full) {
      $bak = "$full.pack-bak"
      Copy-Item $full $bak -Force
      $script:srcMetaBak += @{ Full = $full; Bak = $bak }
    }
  }
  Write-Host "  [ok] source meta snapshotted (Constants.js / manifest.json)"
}

function Restore-SourceMeta {
  if (-not $script:srcMetaBak) { return }
  foreach ($it in $script:srcMetaBak) {
    if (Test-Path $it.Bak) {
      Copy-Item $it.Bak $it.Full -Force
      Remove-Item $it.Bak -Force -ErrorAction SilentlyContinue
      Write-Host "  [ok] restored $(Split-Path $it.Full -Leaf)"
    }
  }
  $script:srcMetaBak = @()
}

function Prepare-Source([string]$code, [string]$appName) {
  Write-Host "==== prepare source (model=$code, app=$appName) ====" -ForegroundColor Cyan
  # SAFETY: never wipe or wholesale-replace the live src tree.
  # src is the working source. src_backup is reference-only and is NOT
  # auto-applied - that path previously destroyed restored sources.

  # REFUSE to pack decompiled / stub sources - they produce broken APKs.
  $bad = @()
  Get-ChildItem (Join-Path $srcDir "*.vue") -Recurse | ForEach-Object {
    if ((Test-DecompiledFile $_.FullName) -or (Test-StubFile $_.FullName)) {
      $bad += $_.FullName
    }
  }
  if ($bad.Count -gt 0) {
    Write-Host "  [ERROR] 检测到反编译/空壳源文件，拒绝打包:" -ForegroundColor Red
    $bad | ForEach-Object { Write-Host "    $_" -ForegroundColor Red }
    Write-Host "  请先执行 node scripts/sync-src-backup.js 或恢复干净 SFC。" -ForegroundColor Yellow
    throw "source integrity check failed: $($bad.Count) bad files"
  }
  Write-Host "  [ok] source integrity check passed" -ForegroundColor Green
  if (-not (Test-Path $srcDir)) { throw "missing src: $srcDir" }

  $homeLib = Join-Path $srcDir "components\HomeLibrary.vue"
  if (Test-StubFile $homeLib) {
    Write-Host "  [warn] src/components/HomeLibrary.vue looks like a stub. Packing will produce an empty 素材库." -ForegroundColor Yellow
    if ((Test-Path $bakDir) -and -not (Test-StubFile (Join-Path $bakDir "components\HomeLibrary.vue"))) {
      Write-Host "  [hint] src_backup has a real HomeLibrary.vue - restore manually if needed (pack will not overwrite src)." -ForegroundColor Yellow
    }
  }

  if ($code -eq "base") {
    Write-Host "  base model: build from live src (no delete, no backup restore)"
  } else {
    $client = Join-Path $cfg.modelsRoot "$code\workspace\app\client"
    if (-not (Test-Path $client)) { throw "model client not found: $client" }
    # Overlay model files onto live src. Snapshot first so finally can restore.
    $overlayBak = Join-Path $root "dist\run\src-overlay-bak-$code"
    if (Test-Path $overlayBak) { Remove-Item $overlayBak -Recurse -Force }
    New-Item -ItemType Directory -Force -Path $overlayBak | Out-Null
    Copy-Item (Join-Path $srcDir "*") $overlayBak -Recurse -Force
    $script:srcOverlayBak = $overlayBak
    Copy-Item (Join-Path $client "*") $srcDir -Recurse -Force
    $pagesFile = Join-Path $srcDir "pages.json"
    $pj = Get-Content $pagesFile -Raw -Encoding UTF8 | ConvertFrom-Json
    foreach ($pg in @($pj.pages)) {
      $vue = Join-Path $client ($pg.path + ".vue")
      if (-not (Test-Path $vue)) { throw "page listed but missing from model client: $($pg.path) ($vue)" }
    }
    Write-Host "  overlay model client done ($($pj.pages.Count) pages validated against model)"
  }

  Backup-SourceMeta
  $port = if ($portMap.ContainsKey($code)) { $portMap[$code] } else { 30001 }
  $constFile = Join-Path $srcDir "common\Constants.js"
  if (Test-Path $constFile) {
    $c = Get-Content $constFile -Raw -Encoding UTF8
    # Only rewrite ports on known server hosts. Do not rebuild the array —
    # SERVER_URL_CANDIDATES may spread from SERVER_SCHEME_PRESETS (nested []).
    $c = $c -replace '(http://(?:127\.0\.0\.1|192\.168\.1\.59|10\.0\.2\.2|39\.107\.120\.55)):\d+', ('$1:' + $port)
    Set-FileLocked $constFile $c -NoNewline
    Write-Host "  Constants.js -> port $port"
  }

  $mf = Join-Path $srcDir "manifest.json"
  if (Test-Path $mf) {
    $data = Get-Content $mf -Raw -Encoding UTF8 | ConvertFrom-Json
    $data.name = $appName
    if ($data.app) { $data.app.name = $appName }
    $json = $data | ConvertTo-Json -Depth 20
    Set-FileLocked $mf $json
    Write-Host "  manifest.json name=$appName"
  }
}

function Build-Www {
  if (-not (Test-Path $uniCmd)) { throw "uni.cmd not found, run npm install first" }
  Write-Host "==== uni build -p app ====" -ForegroundColor Cyan
  $uniLog = Join-Path $cfg.uniProject "uni-build.log"
  $uniErr = Join-Path $cfg.uniProject "uni-build.err.log"
  $p = Start-Process -FilePath $uniCmd `
    -ArgumentList "build", "-p", "app" `
    -WorkingDirectory $cfg.uniProject `
    -RedirectStandardOutput $uniLog `
    -RedirectStandardError $uniErr `
    -Wait -PassThru -NoNewWindow
  Get-Content $uniLog -Tail 10 -ErrorAction SilentlyContinue | ForEach-Object { Write-Host "  $_" }
  if ($p.ExitCode -ne 0) {
    Get-Content $uniErr -Tail 25 -ErrorAction SilentlyContinue | ForEach-Object { Write-Host "  [err] $_" }
    throw "uni build failed exit=$($p.ExitCode), log=$uniErr"
  }
  $svc = Join-Path $wwwOut "app-service.js"
  if (-not (Test-Path $svc)) { throw "build output missing app-service.js" }
  $t = Get-Content $svc -Raw -Encoding UTF8
  if ($t.Contains("versionTabs:versionTabs")) {
    $t = $t.Replace("versionTabs:versionTabs", "")
    $t = $t -replace ",\s*,", ","
    $t = $t -replace "\}\s*,", "},"
    $t = $t -replace ",\s*\}", "}"
    Set-FileLocked $svc $t -NoNewline
    Write-Host "  fixed versionTabs"
  }
  # 写入本次 buildCode，保证安装后 plus.runtime 与服务端可比
  if ($script:verInfo) {
    $wwwMf = Join-Path $wwwOut "manifest.json"
    if (Test-Path $wwwMf) {
      try {
        $mfData = Get-Content $wwwMf -Raw -Encoding UTF8 | ConvertFrom-Json
        if (-not $mfData.version) { $mfData | Add-Member -NotePropertyName version -NotePropertyValue ([pscustomobject]@{}) -Force }
        $mfData.version | Add-Member -NotePropertyName name -NotePropertyValue $script:verInfo.versionName -Force
        $mfData.version | Add-Member -NotePropertyName code -NotePropertyValue ([string]$script:verInfo.buildCode) -Force
        ($mfData | ConvertTo-Json -Depth 20) | Set-Content -Path $wwwMf -Encoding UTF8
        Write-Host "  www version=$($script:verInfo.versionName) code=$($script:verInfo.buildCode)"
      } catch {
        Write-Host "  [warn] patch www version failed: $($_.Exception.Message)"
      }
    }
  }
  if (Test-Path $wwwDst) { Remove-Item $wwwDst -Recurse -Force }
  Copy-Tree $wwwOut $wwwDst
  $md5 = Get-Md5Hex $svc
  Write-Host "  www synced, app-service.js md5=$md5"
}

function Set-AppName([string]$appName) {
  $strings = Join-Path $offlineApp "src\main\res\values\strings.xml"
  $xml = "<?xml version=`"1.0`" encoding=`"utf-8`"?>`n<resources>`n    <string name=`"app_name`">$appName</string>`n</resources>`n"
  Set-FileLocked $strings $xml
  Write-Host "  strings.xml app_name=$appName"
}

function Invoke-Gradle {
  Write-Host "==== gradle assembleRelease ====" -ForegroundColor Cyan
  if (-not (Test-Path $gradle)) { throw "gradle not found: $gradle" }
  $log = Join-Path $cfg.offlineProject "gradle-pack.log"
  $logErr = Join-Path $cfg.offlineProject "gradle-pack.err.log"
  $p = Start-Process -FilePath $gradle `
    -ArgumentList "assembleRelease", "--no-daemon" `
    -WorkingDirectory $cfg.offlineProject `
    -RedirectStandardOutput $log `
    -RedirectStandardError $logErr `
    -Wait -PassThru -NoNewWindow
  Get-Content $log -Tail 15 -ErrorAction SilentlyContinue | ForEach-Object { Write-Host "  $_" }
  if ($p.ExitCode -ne 0) {
    Get-Content $logErr -Tail 20 -ErrorAction SilentlyContinue | ForEach-Object { Write-Host "  [err] $_" }
    throw "gradle assembleRelease failed exit=$($p.ExitCode), log=$log"
  }
}

function Publish-Apk([string]$appName, [string]$code) {
  $built = Join-Path $cfg.offlineProject "app\build\outputs\apk\release\app-release.apk"
  if (-not (Test-Path $built)) { throw "app-release.apk not found" }
  $stamp = Get-Date -Format "yyyyMMddHHmmss"
  $outDir = $cfg.outputDir
  New-Item -ItemType Directory -Force -Path $outDir | Out-Null
  $verLabel = if ($script:verInfo) { "$($script:verInfo.versionName)-$($script:verInfo.buildCode)" } else { "1.0.0-200" }
  $dst1 = Join-Path $outDir "album-sync-offline-$appName-$verLabel-$stamp.apk"
  Copy-Item $built $dst1 -Force
  Write-Host ("[OK] {0}  ({1} MB)" -f $dst1, [math]::Round((Get-Item $built).Length/1MB,2)) -ForegroundColor Green
  if ($code -ne "base") {
    $mOut = Join-Path $root "model-out\$code"
    New-Item -ItemType Directory -Force -Path $mOut | Out-Null
    $dst2 = Join-Path $mOut "$appName-offline.apk"
    Copy-Item $built $dst2 -Force
    Write-Host "[OK] $dst2" -ForegroundColor Green
    if ($nameMap.ContainsKey($code)) {
      $dst3 = Join-Path (Join-Path (Join-Path $cfg.modelsRoot $code) "output") ($appName + ".apk")
      $outParent = Split-Path -Parent $dst3
      if (-not (Test-Path $outParent)) { New-Item -ItemType Directory -Force -Path $outParent | Out-Null }
      Copy-Item $built $dst3 -Force
      Write-Host "[OK] $dst3" -ForegroundColor Green
    }
  }
  return $dst1
}

function Resolve-Adb {
  $cands = @(
    (Join-Path $cfg.androidSdkRoot "platform-tools\adb.exe"),
    (Join-Path $env:LOCALAPPDATA "Android\Sdk\platform-tools\adb.exe"),
    "C:\Users\lrp\Downloads\HBuilderX\plugins\launcher-tools\tools\adbs\adb.exe",
    "C:\Users\lrp\Downloads\scrcpy-win64-v3.3.4\adb.exe"
  )
  foreach ($c in $cands) {
    if ($c -and (Test-Path $c)) { return $c }
  }
  return "adb"
}

function Get-AdbOnline {
  param([string]$Adb, [string]$Serial = "")
  $raw = (& $Adb devices 2>&1 | Out-String)
  $serials = New-Object System.Collections.Generic.List[string]
  foreach ($line in ($raw -split "`r?`n")) {
    if ($line -match '^(?<sn>\S+)\s+device\b') { [void]$serials.Add($Matches.sn) }
  }
  return [pscustomobject]@{ Serials = @($serials); Raw = $raw }
}

function Wait-AdbDevice {
  param([string]$Adb, [string]$Serial = "", [int]$TimeoutSec = 45)
  $deadline = (Get-Date).AddSeconds($TimeoutSec)
  $label = if ($Serial) { $Serial } else { "任意在线设备" }
  while ($true) {
    $info = Get-AdbOnline -Adb $Adb -Serial $Serial
    if ($Serial) {
      if ($info.Serials -contains $Serial) { return $Serial }
    } else {
      if ($info.Serials.Count -eq 1) { return $info.Serials[0] }
      if ($info.Serials.Count -gt 1) {
        throw "多台设备在线，请指定 -Serial。当前:`n$($info.Raw)"
      }
    }
    $left = [int][math]::Max(0, ($deadline - (Get-Date)).TotalSeconds)
    if ($left -le 0) { break }
    Write-Host ("  等待设备 {0} … 剩余 {1}s" -f $label, $left)
    Start-Sleep -Seconds 3
  }
  $info = Get-AdbOnline -Adb $Adb -Serial $Serial
  throw ("设备 {0} 不在线（打包期间可能已断开/未授权）。当前设备列表:`n{1}" -f $label, $info.Raw)
}

function Install-ApkToDevice {
  param([string]$Adb, [string]$Apk, [string]$Serial = "")
  Write-Host ""
  Write-Host "==== ADB 安装 ===="
  Write-Host "  adb=$Adb"
  Write-Host "  apk=$Apk"

  $target = Wait-AdbDevice -Adb $Adb -Serial $Serial -TimeoutSec 45
  Write-Host "  目标设备: $target"

  $installArgs = @("-s", $target, "install", "-r", "-d", $Apk)
  Write-Host "  $Adb $($installArgs -join ' ')"
  $out = (& $Adb @installArgs 2>&1 | Out-String)
  $code = $LASTEXITCODE
  Write-Host ($out.TrimEnd())

  if ($code -ne 0 -or $out -notmatch "Success") {
    throw ("ADB 安装失败 exit=$code`n{0}" -f $out)
  }

  $pkg = $cfg.packageName
  if ($pkg) {
    $pathOut = (& $Adb -s $target shell pm path $pkg 2>&1 | Out-String)
    if ($pathOut -match "package:") {
      Write-Host "  包已安装: $pkg" -ForegroundColor Green
    } else {
      Write-Host "  警告: pm path 未返回 $pkg（安装可能仍成功）`n$pathOut" -ForegroundColor Yellow
    }
  }
  Write-Host "[install] OK -> $target" -ForegroundColor Green
}

# ===== main =====
# 版本策略：是否抬版本交互询问；机器号每次出包 +1
$verScript = Join-Path $scripts "version-bump.ps1"
$verArgs = @()
if ($BumpVersion) { $verArgs += "-BumpVersion" }
if ($NoPrompt) { $verArgs += "-NoPrompt" }
$verOut = & powershell -NoProfile -ExecutionPolicy Bypass -File $verScript @verArgs
if ($LASTEXITCODE -ne 0) { throw "version-bump failed exit=$LASTEXITCODE" }
$verLine = ($verOut | Where-Object { "$_" -like '@VER@*' } | Select-Object -Last 1)
if (-not $verLine) { throw "version-bump no output" }
$script:verInfo = ($verLine.Substring(5) | ConvertFrom-Json)
Write-Host ("[version] {0}  buildCode={1}  machine={2}" -f $script:verInfo.versionName, $script:verInfo.buildCode, $script:verInfo.machineCode)

if (-not $SkipImport) { Restore-SdkAssets }

# Concurrency lock: one pack at a time (shared src/dist/www)
$lockDir = Join-Path $root "dist\run"
New-Item -ItemType Directory -Force -Path $lockDir | Out-Null
$lockFile = Join-Path $lockDir "pack.lock"
if (Test-Path $lockFile) {
  $lockAge = (Get-Date) - (Get-Item $lockFile).LastWriteTime
  if ($lockAge.TotalMinutes -lt 30) {
    throw "Another pack is running (lock $($lockFile), age $([int]$lockAge.TotalMinutes)m). Delete lock if stale."
  }
  Write-Host "[warn] stale pack.lock, taking over" -ForegroundColor Yellow
}
Set-Content -Path $lockFile -Value "$PID $(Get-Date -Format o)" -Encoding UTF8

$appName = [char]0x7D20 + [char]0x6750 + [char]0x5E93  # default CJK name
if ($code -ne "base" -and $nameMap.ContainsKey($code)) { $appName = "$appName-$($nameMap[$code])" }

if ($Install) {
  $adbPath = Resolve-Adb
  $pre = Get-AdbOnline -Adb $adbPath -Serial $Serial
  if ($Serial -and ($pre.Serials -notcontains $Serial)) {
    Write-Host ("[warn] 设备 {0} 当前未连接，打包完成后会继续等待重连后安装。" -f $Serial) -ForegroundColor Yellow
    Write-Host ("  当前设备:`n{0}" -f $pre.Raw)
  }
}

try {
  Prepare-Source $code $appName
  if (-not $SkipBuild) { Build-Www } else { Write-Host "[warn] -SkipBuild: using existing dist/build/app (not a fresh compile)" -ForegroundColor Yellow }
  Set-AppName $appName
  Invoke-Gradle
  $apk = Publish-Apk $appName $code
} finally {
  # Always restore source files Prepare-Source rewrote. Never leave src mutated.
  Restore-SourceMeta
  if ($script:srcOverlayBak -and (Test-Path $script:srcOverlayBak)) {
    # Mirror restore: wipe overlaid extras then copy snapshot back
    Get-ChildItem $srcDir -Force | ForEach-Object { Remove-Item $_.FullName -Recurse -Force -ErrorAction SilentlyContinue }
    Copy-Item (Join-Path $script:srcOverlayBak "*") $srcDir -Recurse -Force
    Write-Host "  [ok] mirrored src restore after model overlay ($code)"
    Remove-Item $script:srcOverlayBak -Recurse -Force -ErrorAction SilentlyContinue
    $script:srcOverlayBak = $null
  }
  if (Test-Path $lockFile) { Remove-Item $lockFile -Force -ErrorAction SilentlyContinue }
}

if ($Install) {
  Install-ApkToDevice -Adb (Resolve-Adb) -Apk $apk -Serial $Serial
}
Write-Host "`nall done."
