# Offline APK pack + push to update channel
param(
  [string]$Note = "离线整包",
  [string]$Channel = "internal",
  [string]$Server = "",
  [string]$User = "admin",
  [string]$Pass = "",
  [switch]$SkipBuild,
  [switch]$SkipImport,
  [switch]$BumpVersion,
  [switch]$NoPrompt,
  [string]$ConfigPath = ""
)
$ErrorActionPreference = "Stop"
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}
# 口令不内置：仅接受参数传入（pack-studio 从 .env 的 PACK_PASS 注入）
$scripts = $PSScriptRoot
$root = Split-Path -Parent $scripts
if (-not $ConfigPath) { $ConfigPath = Join-Path $scripts "offline-config.json" }
$cfg = Get-Content $ConfigPath -Raw -Encoding UTF8 | ConvertFrom-Json

Write-Host "======== 1/2 本地离线整包 APK ========"
$packArgs = @()
if ($SkipBuild) { $packArgs += "-SkipBuild" }
if ($SkipImport) { $packArgs += "-SkipImport" }
if ($BumpVersion) { $packArgs += "-BumpVersion" }
if ($NoPrompt) { $packArgs += "-NoPrompt" }
if ($ConfigPath) { $packArgs += @("-ConfigPath", $ConfigPath) }
powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $scripts "pack-offline-apk.ps1") @packArgs
if ($LASTEXITCODE -ne 0) { throw "pack-offline-apk 失败 exit=$LASTEXITCODE" }

$outDir = $cfg.outputDir
if (-not $outDir) { $outDir = Join-Path $root "dist\release\apk" }
$apk = Get-ChildItem $outDir -Filter "album-sync-offline-*.apk" -ErrorAction SilentlyContinue |
  Where-Object { $_.Name -notlike "*.json" } |
  Sort-Object LastWriteTime -Descending |
  Select-Object -First 1
if (-not $apk) { throw "未找到离线 APK（$outDir\album-sync-offline-*.apk）" }
Write-Host "产物 $($apk.FullName)  $([math]::Round($apk.Length/1MB,2)) MB"

Write-Host ""
Write-Host "======== 2/2 推送到更新通道 ========"
powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $scripts "push-update.ps1") `
  -File $apk.FullName -Note $Note -Channel $Channel -Server $Server -User $User -Pass $Pass -Force
if ($LASTEXITCODE -ne 0) { throw "push apk 失败" }

Write-Host ""
Write-Host "完成。手机检查更新会拉到离线本地打包的 APK。"
Write-Host "  $($apk.Name)"
