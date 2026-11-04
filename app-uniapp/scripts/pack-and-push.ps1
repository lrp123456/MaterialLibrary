# 一键：打包 WGT 并推送到更新通道
# 用法:
#   powershell -ExecutionPolicy Bypass -File scripts\pack-and-push.ps1 -Note 热更新WGT -Channel internal -Force
#   powershell -ExecutionPolicy Bypass -File scripts\pack-and-push.ps1 -SkipBuild -Note 仅用现有www
param(
  [string]$Note = "热更新",
  [string]$Channel = "internal",
  [string]$Server = "",
  [string]$User = "admin",
  [string]$Pass = "",
  [switch]$Canary,
  [switch]$Promote,
  [switch]$Revoke,
  [switch]$Status,
  [switch]$Force,
  [switch]$SkipBuild,
  [switch]$BumpVersion,
  [switch]$NoPrompt
)
$ErrorActionPreference = "Stop"
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}
# 口令不内置：仅接受参数传入（pack-studio 从 .env 的 PACK_PASS 注入）
$scripts = $PSScriptRoot
$root = Split-Path -Parent $scripts

if ($Status -or $Revoke -or $Promote) {
  $pushScript = Join-Path $scripts "push-update.ps1"
  $fwdArgs = @("-Server", $Server, "-User", $User, "-Pass", $Pass)
  if ($Status) { $fwdArgs += "-Status" }
  if ($Revoke) { $fwdArgs += "-Revoke" }
  if ($Promote) { $fwdArgs += "-Promote" }
  powershell -ExecutionPolicy Bypass -File $pushScript @fwdArgs
  exit $LASTEXITCODE
}

Write-Host "======== 1/2 本地打包 WGT ========"
$packArgs = @("-Note", $Note)
if ($SkipBuild) { $packArgs += "-SkipBuild" }
if ($BumpVersion) { $packArgs += "-BumpVersion" }
if ($NoPrompt) { $packArgs += "-NoPrompt" }
$packScript = Join-Path $scripts "pack-wgt.ps1"
powershell -ExecutionPolicy Bypass -File $packScript @packArgs
if ($LASTEXITCODE -ne 0) { throw "pack-wgt 失败 exit=$LASTEXITCODE" }

$outDir = Join-Path $root "dist\release\wgt"
$wgt = Get-ChildItem $outDir -Filter "*.wgt" -ErrorAction SilentlyContinue |
  Where-Object { $_.FullName -notmatch 'bad_archive' } |
  Sort-Object LastWriteTime -Descending |
  Select-Object -First 1
if (-not $wgt) { throw "未找到 WGT（$outDir\*.wgt）" }
Write-Host ("产物 {0}  {1} KB" -f $wgt.FullName, [math]::Round($wgt.Length/1KB,2))

Write-Host ""
Write-Host "======== 2/2 推送到更新通道 ========"
$pushArgs = @(
  "-File", $wgt.FullName,
  "-Note", $Note,
  "-Channel", $Channel,
  "-Server", $Server,
  "-User", $User,
  "-Pass", $Pass
)
if ($Force) { $pushArgs += "-Force" }
if ($Canary) { $pushArgs += "-Canary" }
$pushScript = Join-Path $scripts "push-update.ps1"
powershell -ExecutionPolicy Bypass -File $pushScript @pushArgs
if ($LASTEXITCODE -ne 0) { throw "push wgt 失败" }

Write-Host ""
Write-Host "完成。手机检查更新会拉到热更新 WGT。"
Write-Host ("  {0}" -f $wgt.Name)
Write-Host ("  {0}/api/app/update?platform=android&versionCode=200&channel={1}" -f $Server, $Channel)