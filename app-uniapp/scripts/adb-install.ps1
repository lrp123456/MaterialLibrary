# ADB install APK to device (optionally push local models first).
# Used by cloud-apk-adb-install.ps1 and pack-studio quick/adb install actions.
# Usage:
#   adb-install.ps1 -Apk path\to\app.apk
#   adb-install.ps1 -Apk app.apk -Serial 3EV0225225010722 -PackageName lrp.aibum
#   adb-install.ps1 -Apk app.apk -PushModels
param(
  [Parameter(Mandatory = $true)][string]$Apk,
  [string]$Serial = "",
  [string]$PackageName = "lrp.aibum",
  [switch]$PushModels,
  [string]$ConfigPath = ""
)
$ErrorActionPreference = "Stop"
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}
$scripts = $PSScriptRoot
if (-not $ConfigPath) {
  $cand = Join-Path $scripts "offline-config.json"
  if (Test-Path $cand) { $ConfigPath = $cand }
}
$cfg = $null
if ($ConfigPath -and (Test-Path $ConfigPath)) {
  try { $cfg = Get-Content $ConfigPath -Raw -Encoding UTF8 | ConvertFrom-Json } catch {}
}

function Resolve-Adb {
  $cands = @()
  if ($cfg -and $cfg.androidSdkRoot) {
    $cands += (Join-Path $cfg.androidSdkRoot "platform-tools\adb.exe")
  }
  if ($env:LOCALAPPDATA) {
    $cands += (Join-Path $env:LOCALAPPDATA "Android\Sdk\platform-tools\adb.exe")
  }
  $cands += @(
    "C:\Users\lrp\Downloads\HBuilderX\plugins\launcher-tools\tools\adbs\adb.exe",
    "C:\Users\lrp\Downloads\scrcpy-win64-v3.3.4\adb.exe"
  )
  foreach ($c in $cands) {
    if ($c -and (Test-Path $c)) { return $c }
  }
  return "adb"
}

function Get-AdbOnline {
  param([string]$Adb)
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
    $info = Get-AdbOnline -Adb $Adb
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
  $info = Get-AdbOnline -Adb $Adb
  throw ("设备 {0} 不在线。当前设备列表:`n{1}" -f $label, $info.Raw)
}

if (-not (Test-Path $Apk)) { throw "APK 不存在: $Apk" }

$adb = Resolve-Adb
Write-Host "==== ADB 安装 ===="
Write-Host "  adb=$adb"
Write-Host "  apk=$Apk"
Write-Host "  package=$PackageName"

$target = Wait-AdbDevice -Adb $adb -Serial $Serial -TimeoutSec 45
Write-Host "  目标设备: $target"

if ($PushModels) {
  $modelRoot = $null
  if ($cfg -and $cfg.localModelsGoodDir) { $modelRoot = $cfg.localModelsGoodDir }
  if (-not $modelRoot -or -not (Test-Path $modelRoot)) {
    $modelRoot = "C:\Users\lrp\DevEcoStudioProjects\MaterialLibraryServer\data\local-models"
  }
  if (Test-Path $modelRoot) {
    Write-Host "  PushModels from $modelRoot"
    $remoteBase = "/sdcard/Android/data/$PackageName/files/local-models"
    & $adb -s $target shell mkdir -p $remoteBase 2>$null | Out-Null
    Get-ChildItem $modelRoot -Directory -ErrorAction SilentlyContinue | ForEach-Object {
      Write-Host ("    push dir {0}" -f $_.Name)
      & $adb -s $target push $_.FullName "$remoteBase/$($_.Name)"
      if ($LASTEXITCODE -ne 0) { Write-Host "    push failed: $($_.Name)" -ForegroundColor Yellow }
    }
    Get-ChildItem $modelRoot -File -ErrorAction SilentlyContinue | Where-Object { $_.Name -match '\.(bin|param|pth|onnx)$' } | ForEach-Object {
      Write-Host ("    push file {0}" -f $_.Name)
      & $adb -s $target push $_.FullName "$remoteBase/"
      if ($LASTEXITCODE -ne 0) { Write-Host "    push failed: $($_.Name)" -ForegroundColor Yellow }
    }
  } else {
    Write-Host "  警略: 未找到模型目录，跳过 PushModels ($modelRoot)" -ForegroundColor Yellow
  }
}

$installArgs = @("-s", $target, "install", "-r", "-d", $Apk)
Write-Host "  $adb $($installArgs -join ' ')"
$out = (& $adb @installArgs 2>&1 | Out-String)
$code = $LASTEXITCODE
Write-Host ($out.TrimEnd())
if ($code -ne 0 -or $out -notmatch "Success") {
  throw ("ADB 安装失败 exit=$code`n{0}" -f $out)
}

if ($PackageName) {
  $pathOut = (& $adb -s $target shell pm path $PackageName 2>&1 | Out-String)
  if ($pathOut -match "package:") {
    Write-Host "  包已安装: $PackageName" -ForegroundColor Green
    Write-Host "  启动应用…"
    & $adb -s $target shell am force-stop $PackageName 2>$null | Out-Null
    & $adb -s $target shell monkey -p $PackageName -c android.intent.category.LAUNCHER 1 2>$null | Out-Null
  } else {
    Write-Host "  警告: pm path 未返回 $PackageName`n$pathOut" -ForegroundColor Yellow
  }
}

Write-Host "[install] OK -> $target" -ForegroundColor Green
exit 0
