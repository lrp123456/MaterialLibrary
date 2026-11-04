# 推送 wgt/apk 到 MaterialLibraryServer 私有更新通道
# 手机端 AppUpdater 启动/回前台 GET /api/app/update → 弹窗安装
#
# 用法:
#   powershell -File scripts\push-update.ps1 -File dist\release\wgt\xxx.wgt -Note "修复xx"
#   powershell -File scripts\push-update.ps1 -File dist\release\apk\xxx.apk -Note "整包" -Force
#   powershell -File scripts\push-update.ps1 -LatestWgt
#   powershell -File scripts\push-update.ps1 -LatestApk -Force
param(
  [string]$File = "",
  [switch]$LatestWgt,
  [switch]$LatestApk,
  [string]$Note = "",
  [string]$ReleaseMode = "full",
  [string]$TargetDevices = "",
  [switch]$Canary,
  [switch]$Promote,
  [switch]$Revoke,
  [switch]$Status,
  [switch]$Force,
  [string]$Server = "",
  [string]$User = "admin",
  [string]$Pass = "",
  [string]$VersionName = "",
  [int]$VersionCode = 0,
  [int]$WgtVersion = 0
)

if ($Canary) {
  $Channel = "canary"
  $ReleaseMode = "canary"
}
# 口令不内置：仅接受参数传入（pack-studio 从 .env 的 PACK_PASS 注入）

if ($Status) {
  Write-Host "[status] 查询当前更新与灰度通道状态..."
  $st = Invoke-RestMethod -Method Get -Uri "$Server/api/app/update/state"
  Write-Host ($st.data | ConvertTo-Json -Depth 5)
  exit 0
}

if ($Revoke) {
  Write-Host "[revoke] 请求撤销当前灰度测试版本..."
  $loginBody = @{ username = $User; password = $Pass } | ConvertTo-Json
  $login = Invoke-RestMethod -Method Post -Uri "$Server/api/auth/login" -ContentType "application/json" -Body $loginBody
  $token = $login.data.token
  if (-not $token) { Write-Error "登录失败: $($login | ConvertTo-Json -Depth 3)" }
  $rev = Invoke-RestMethod -Method Post -Uri "$Server/api/app/update/revoke-canary" -Headers @{ Authorization = "Bearer $token" }
  Write-Host "[revoke] 成功撤销灰度版本，已停止灰度通道分发: $($rev.data | ConvertTo-Json)"
  exit 0
}

if ($Promote) {
  Write-Host "[promote] 请求将灰度测试版本一键转正..."
  $loginBody = @{ username = $User; password = $Pass } | ConvertTo-Json
  $login = Invoke-RestMethod -Method Post -Uri "$Server/api/auth/login" -ContentType "application/json" -Body $loginBody
  $token = $login.data.token
  if (-not $token) { Write-Error "登录失败: $($login | ConvertTo-Json -Depth 3)" }
  $prom = Invoke-RestMethod -Method Post -Uri "$Server/api/app/update/promote" -Headers @{ Authorization = "Bearer $token" }
  Write-Host "[promote] 成功转正为全量发布: $($prom.data | ConvertTo-Json)"
  exit 0
}

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
if (-not (Test-Path (Join-Path $root "src\manifest.json"))) { $root = (Get-Location).Path }

function Resolve-Latest([string]$dir, [string]$ext) {
  $p = Join-Path $root $dir
  if (-not (Test-Path $p)) { return $null }
  return Get-ChildItem $p -Filter "*.$ext" -ErrorAction SilentlyContinue |
    Where-Object { $_.FullName -notmatch 'bad_archive' } |
    Sort-Object LastWriteTime -Descending | Select-Object -First 1
}

if ($LatestWgt) { $File = (Resolve-Latest "dist\release\wgt" "wgt").FullName }
if ($LatestApk) { $File = (Resolve-Latest "dist\release\apk" "apk").FullName }
if (-not $File -or -not (Test-Path $File)) {
  Write-Error "请指定 -File 或使用 -LatestWgt / -LatestApk"
}

$item = Get-Item $File
$isApk = $item.Extension -ieq ".apk"
if (-not $Note) { $Note = if ($isApk) { "整包更新" } else { "热更新" } }

# 安全检查：如果推送的是 WGT，验证其内部完整性与语法
if (-not $isApk) {
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $zip = [System.IO.Compression.ZipFile]::OpenRead($item.FullName)
  try {
    $svcEntry = $zip.GetEntry("app-service.js")
    if (-not $svcEntry) {
      throw "待推送的 WGT 包内缺少 app-service.js，拒绝推送！"
    }
    $stream = $svcEntry.Open()
    $reader = New-Object System.IO.StreamReader($stream)
    $content = $reader.ReadToEnd()
    $reader.Dispose()
    $stream.Dispose()
    if ($content -match 'versionTabs:versionTabs') {
      throw "严重拦截：待推送的 WGT 包内检测到致命未定义语法 'versionTabs:versionTabs'，拒绝推送！"
    }
    $mfEntry = $zip.GetEntry("manifest.json")
    if (-not $mfEntry) {
      throw "待推送的 WGT 包内缺少 manifest.json，拒绝推送！"
    }
  } finally {
    $zip.Dispose()
  }
}

# 读 sidecar（打包时已写好 buildCode）；无 sidecar 时回退到 version-state
$side = $item.FullName + ".json"
$srcManifest = Get-Content (Join-Path $root "src\manifest.json") -Raw | ConvertFrom-Json
if (Test-Path $side) {
  $meta = Get-Content $side -Raw | ConvertFrom-Json
  if (-not $VersionName) { $VersionName = $meta.versionName }
  if ($VersionCode -le 0) { $VersionCode = [int]$meta.versionCode }
  if ($WgtVersion -le 0 -and $meta.wgtVersion) { $WgtVersion = [int]$meta.wgtVersion }
  if ($meta.note -and $Note -eq "热更新") { $Note = $meta.note }
}
if (-not $VersionName) { $VersionName = $srcManifest.versionName }
if ($VersionCode -le 0) {
  $vs = Join-Path $root "src\version-state.json"
  if (Test-Path $vs) {
    try {
      $st = Get-Content $vs -Raw | ConvertFrom-Json
      if ($st.buildCode) { $VersionCode = [int]$st.buildCode }
    } catch {}
  }
  if ($VersionCode -le 0) { $VersionCode = [int]$srcManifest.versionCode }
}
if ($WgtVersion -le 0) {
  # 从文件名 album-sync-<code>-... 提取
  if ($item.Name -match '(\d{3,})') { $WgtVersion = [int]$Matches[1] }
  else { $WgtVersion = $VersionCode }
}

Write-Host "[push] $File"
Write-Host "       type=$(if($isApk){'apk'}else{'wgt'}) versionCode=$VersionCode wgtVersion=$WgtVersion channel=$Channel force=$Force"
Write-Host "       server=$Server size=$([math]::Round($item.Length/1MB,2))MB"

Write-Host "[1] 登录..."
$loginBody = @{ username = $User; password = $Pass } | ConvertTo-Json
$login = Invoke-RestMethod -Method Post -Uri "$Server/api/auth/login" -ContentType "application/json" -Body $loginBody
$token = $login.data.token
if (-not $token) { Write-Error "登录失败: $($login | ConvertTo-Json -Depth 3)" }

$qs = @(
  "fileName=$([uri]::EscapeDataString($item.Name))",
  "versionCode=$VersionCode",
  "versionName=$([uri]::EscapeDataString($VersionName))",
  "note=$([uri]::EscapeDataString($Note))",
  "channel=$Channel"
)
if (-not $isApk) { $qs += "wgtVersion=$WgtVersion" }
if ($isApk) { $qs += "type=apk" } else { $qs += "type=wgt" }
if ($Force) { $qs += "force=true" }
if ($ReleaseMode) { $qs += "releaseMode=$ReleaseMode" }
if ($TargetDevices) { $qs += "targetDevices=$([uri]::EscapeDataString($TargetDevices))" }

$uri = "$Server/api/app/update/upload?" + ($qs -join "&")
Write-Host "[2] 上传 $uri"

# 大文件分块读，避免超大字节数组一次分配（APK 通常几十 MB，直接读即可）
$bytes = [System.IO.File]::ReadAllBytes($item.FullName)
$up = Invoke-RestMethod -Method Post -Uri $uri -Headers @{ Authorization = "Bearer $token" } `
  -ContentType "application/octet-stream" -Body $bytes

Write-Host "[3] 服务端响应:"
Write-Host ($up | ConvertTo-Json -Depth 5)

Write-Host ""
Write-Host "已发布。手机端启动/回前台将检查:"
Write-Host "  $Server/api/app/update?platform=android&versionCode=$VersionCode&wgtVersion=$WgtVersion&channel=$Channel"
if ($Force) {
  Write-Host "已设为强制更新。"
} else {
  Write-Host "可再强制推送: curl -X POST `$Server/api/app/update/quick-push -H 'Authorization: Bearer <token>'"
}
