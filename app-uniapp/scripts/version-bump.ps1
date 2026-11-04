# 版本号策略
#   版本号 versionName/versionCode：人工发版时才 +1，且机器号清零
#   机器号 machineCode：每次出包/推送 +1，直到版本号 +1 后重置
#   buildCode = versionCode * 10000 + machineCode，用于安装包/热更比较
#
# 用法（供其他脚本调用，输出 JSON 到 stdout 最后一行 @VER@{...}）:
#   powershell -File scripts\version-bump.ps1                 # 交互询问是否抬版本
#   powershell -File scripts\version-bump.ps1 -NoPrompt       # 仅机器号 +1
#   powershell -File scripts\version-bump.ps1 -BumpVersion    # 版本 +1，机器号清零
#   powershell -File scripts\version-bump.ps1 -Peek           # 只读，不改状态
param(
  [switch]$BumpVersion,
  [switch]$NoPrompt,
  [switch]$Peek,
  [string]$Root = ""
)
$ErrorActionPreference = "Stop"
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}

if (-not $Root) {
  $Root = Split-Path -Parent $PSScriptRoot
  if (-not (Test-Path (Join-Path $Root "src\manifest.json"))) { $Root = (Get-Location).Path }
}

$statePath = Join-Path $Root "src\version-state.json"
$manifestPath = Join-Path $Root "src\manifest.json"

function Read-State {
  if (Test-Path $statePath) {
    try {
      $s = Get-Content $statePath -Raw -Encoding UTF8 | ConvertFrom-Json
      return @{
        versionName = [string]$s.versionName
        versionCode = [int]$s.versionCode
        machineCode = [int]$s.machineCode
        history     = @($s.history)
      }
    } catch {}
  }
  # 从 manifest 初始化
  $vn = "1.0.0"
  $vc = 200
  if (Test-Path $manifestPath) {
    try {
      $mf = Get-Content $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
      if ($mf.versionName) { $vn = [string]$mf.versionName }
      if ($mf.versionCode) {
        $vc = [int]$mf.versionCode
        # manifest 里写的是 buildCode（versionCode*10000+machine），还原基版本号
        if ($vc -ge 10000) { $vc = [int][math]::Floor($vc / 10000) }
      }
    } catch {}
  }
  return @{
    versionName = $vn
    versionCode = $vc
    machineCode = 0
    history     = @()
  }
}

function Bump-VersionName([string]$name) {
  if ($name -match '^(\d+)\.(\d+)\.(\d+)(.*)$') {
    $patch = [int]$Matches[3] + 1
    return "$($Matches[1]).$($Matches[2]).$patch$($Matches[4])"
  }
  return $name
}

function Write-State($st, [string]$note) {
  $st.history = @($st.history | Select-Object -Last 40)
  $st.history += @{
    at          = (Get-Date).ToString("s")
    versionName = $st.versionName
    versionCode = $st.versionCode
    machineCode = $st.machineCode
    buildCode   = ($st.versionCode * 10000 + $st.machineCode)
    note        = $note
  }
  $out = [ordered]@{
    versionName = $st.versionName
    versionCode = [int]$st.versionCode
    machineCode = [int]$st.machineCode
    buildCode   = [int]($st.versionCode * 10000 + $st.machineCode)
    updatedAt   = (Get-Date).ToString("s")
    history     = $st.history
  }
  $dir = Split-Path -Parent $statePath
  if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
  ($out | ConvertTo-Json -Depth 6) | Set-Content -Path $statePath -Encoding UTF8

  # 同步 src/manifest.json 的 versionName / versionCode（versionCode 写 buildCode，
  # 这样 APK 原生 versionCode 与 www/wgt 可比较）
  if (Test-Path $manifestPath) {
    try {
      $mf = Get-Content $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
      $mf.versionName = $out.versionName
      $mf.versionCode = [string]$out.buildCode
      $json = $mf | ConvertTo-Json -Depth 20
      Set-Content -Path $manifestPath -Value $json -Encoding UTF8
    } catch {
      Write-Host "  [warn] 更新 manifest.json 版本失败: $($_.Exception.Message)"
    }
  }
}

# ---------- 主流程 ----------
$st = Read-State
$doBumpVersion = $false

if ($Peek) {
  $buildCode = [int]($st.versionCode * 10000 + $st.machineCode)
  $result = [ordered]@{
    versionName = $st.versionName
    versionCode = [int]$st.versionCode
    machineCode = [int]$st.machineCode
    buildCode   = $buildCode
    bumped      = $false
    peek        = $true
  }
  Write-Host "[version] peek  $($st.versionName) (ver=$($st.versionCode) machine=$($st.machineCode)) build=$buildCode"
  Write-Output ("@VER@" + ($result | ConvertTo-Json -Compress))
  return
}

if ($BumpVersion) {
  $doBumpVersion = $true
} elseif (-not $NoPrompt) {
  # 交互终端才弹；后台/pack-studio 默认只涨机器号
  $interactive = $false
  try {
    if ($Host -and $Host.UI -and $Host.UI.RawUI) {
      $interactive = [Environment]::UserInteractive -and -not [Console]::IsInputRedirected
    }
  } catch {}
  if ($interactive) {
    Write-Host ""
    Write-Host "======== 版本号策略 ========" -ForegroundColor Cyan
    Write-Host "  当前: $($st.versionName)  (版本码 $($st.versionCode) / 机器号 $($st.machineCode))"
    Write-Host "  y = 更新版本号（版本+1，机器号清零）"
    Write-Host "  n = 保持版本号（仅机器号 +1）"
    $ans = Read-Host "本次是否更新版本号? [y/N]"
    if ($ans -match '^(y|yes|Y|是)$') { $doBumpVersion = $true }
  } else {
    Write-Host "[version] 非交互环境，保持版本号，仅机器号 +1（如需抬版本请加 -BumpVersion）"
  }
}

if ($doBumpVersion) {
  $oldName = $st.versionName
  $oldCode = $st.versionCode
  $st.versionName = Bump-VersionName $st.versionName
  $st.versionCode = [int]$st.versionCode + 1
  $st.machineCode = 0
  Write-State $st "version-bump $oldName/$oldCode -> $($st.versionName)/$($st.versionCode)"
  Write-Host "[version] 版本号 +1: $oldName ($oldCode) -> $($st.versionName) ($($st.versionCode))，机器号清零" -ForegroundColor Green
} else {
  $st.machineCode = [int]$st.machineCode + 1
  Write-State $st "machine+1"
  Write-Host "[version] 机器号 +1: $($st.versionName) 机器号 $($st.machineCode)" -ForegroundColor Green
}

$buildCode = [int]($st.versionCode * 10000 + $st.machineCode)
$result = [ordered]@{
  versionName = $st.versionName
  versionCode = [int]$st.versionCode
  machineCode = [int]$st.machineCode
  buildCode   = $buildCode
  bumped      = $doBumpVersion
  peek        = $false
}
Write-Host "[version] buildCode=$buildCode  ($($st.versionName) + build $($st.machineCode))"
Write-Output ("@VER@" + ($result | ConvertTo-Json -Compress))
