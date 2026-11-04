# AlbumSync 手动打包 · WGT 热更新包
# 产物: dist/release/wgt/album-sync-<buildCode>.wgt
# 版本策略见 scripts\version-bump.ps1：是否抬版本交互询问，机器号每次出包 +1
#
# 用法:
#   powershell -ExecutionPolicy Bypass -File scripts\pack-wgt.ps1
#   powershell -ExecutionPolicy Bypass -File scripts\pack-wgt.ps1 -Note "修复编辑器点选" -BumpVersion
#   powershell -ExecutionPolicy Bypass -File scripts\pack-wgt.ps1 -SkipBuild -NoPrompt
param(
  [string]$VersionName = "",
  [string]$Note = "热更新",
  [switch]$SkipBuild,
  [switch]$BumpVersion,
  [switch]$NoPrompt,
  [int]$WgtCode = 0,
  [string]$HbxCli = "C:\Users\lrp\Downloads\HBuilderX\cli.exe"
)

$ErrorActionPreference = "Stop"
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}
$root = Split-Path -Parent $PSScriptRoot
if (-not (Test-Path (Join-Path $root "src\manifest.json"))) { $root = (Get-Location).Path }
Set-Location $root
Write-Host "[pack-wgt] 项目: $root"

# 版本策略：交互询问是否抬版本；机器号每次出包 +1
$verScript = Join-Path $root "scripts\version-bump.ps1"
$verArgs = @()
if ($BumpVersion) { $verArgs += "-BumpVersion" }
if ($NoPrompt) { $verArgs += "-NoPrompt" }
$verOut = & powershell -ExecutionPolicy Bypass -File $verScript @verArgs
if ($LASTEXITCODE -ne 0) { throw "version-bump 失败 exit=$LASTEXITCODE" }
$verLine = ($verOut | Where-Object { "$_" -like '@VER@*' } | Select-Object -Last 1)
if (-not $verLine) { throw "version-bump 无有效输出" }
$ver = ($verLine.Substring(5) | ConvertFrom-Json)
if (-not $VersionName) { $VersionName = $ver.versionName }
if ($WgtCode -le 0) { $WgtCode = [int]$ver.buildCode }
Write-Host "[version] versionName=$VersionName machine=$($ver.machineCode) buildCode=$($ver.buildCode)"

function Get-WwwScore([string]$dir) {
  $svc = Join-Path $dir "app-service.js"
  if (-not (Test-Path $svc)) { return -1 }
  $raw = Get-Content $svc -Raw -ErrorAction SilentlyContinue
  if (-not $raw) { return -1 }
  $mtime = (Get-Item $svc).LastWriteTime
  $score = [double]$mtime.Ticks / 1e10
  # ⚠️ 以下三项是「硬门槛」：不合格直接判死（-1000），只有全过的候选才参与时间比较。
  # 曾经写成 +5/-8/-3/-20 的加减分 → 旧产物只要指纹对就能靠加分压过时间差，
  # 于是在 uni build 失败的情况下依然选中几天前的目录重新打包推送，
  # 表现为「所有新功能在 App 里都看不见」但编译日志里只是红色报错。
  #
  # ⚠️ `192.168.` 绝不能当硬门槛：ServerResolve.js 里「局域网」方案
  # 合法内置了 192.168.x:30001 候选地址，命中是正常的。
  # 只在「有内网地址却没有公网地址」这种组合下才判可疑。
  if ($raw -match '39\.107\.120\.55') { } else { $score -= 1000 }
  if ($raw -match '体验演示模式') { $score -= 1000 }
  if ($raw -match 'versionTabs:versionTabs') { $score -= 1000 }
  if ($raw -match '192\.168\.\d+\.\d+' -and $raw -notmatch '39\.107\.120\.55') { $score -= 1000 }
  return $score
}

function Select-BestWww([string]$projRoot) {
  $candidates = @(
    (Join-Path $projRoot "dist\build\app"),
    (Join-Path $projRoot "dist\build\app-plus"),
    (Join-Path $projRoot "unpackage\resources\__UNI__F183218\www"),
    (Join-Path $projRoot "dist\dev\app-plus")
  )
  $best = $null
  $bestScore = -1
  foreach ($c in $candidates) {
    $s = Get-WwwScore $c
    Write-Host ("    cand {0} score={1}" -f $c, $s)
    if ($s -gt $bestScore) { $bestScore = $s; $best = $c }
  }
  return @{ Path = $best; Score = $bestScore }
}

# 1. 编译（默认会编；-SkipBuild 才跳过）
if (-not $SkipBuild) {
  Write-Host "[1] 重新编译前端资源（防止打进旧 www）..."
  $uniCmd = Join-Path $root "node_modules\.bin\uni.cmd"
  $built = $false
  $buildStarted = Get-Date
  if (Test-Path $uniCmd) {
    # ⚠️ 这里必须显式检查 $LASTEXITCODE。
    # 原写法在 try 块里无条件 `$built = $true`，
    # 而 uni build 失败（import 路径写错、语法错误等）并不会抛异常，
    # 只是返回非 0 → 编译失败被静默吞掉，脚本继续用旧产物打包推送。
    # 这是「App 里所有新功能都看不见」的根因，务必保留这个判断。
    $uniExit = 1
    try {
      Push-Location $root
      & $uniCmd build -p app 2>&1 | Tee-Object -Variable uniLog
      $uniExit = $LASTEXITCODE
      Pop-Location
    } catch {
      try { Pop-Location } catch {}
      Write-Warning "uni build 异常: $_"
      $uniExit = 1
    }
    if ($uniExit -eq 0) {
      $built = $true
      Write-Host "    uni build -p app 完成"
    } else {
      Write-Host ""
      Write-Host "  ══════════════════════════════════════════════════════" -ForegroundColor Red
      Write-Host "   uni build 失败（exit=$uniExit）" -ForegroundColor Red
      Write-Host "   不会用旧产物打包。请先修掉编译错误，或用 -SkipBuild 明确表示要复用现有 www。" -ForegroundColor Red
      Write-Host "   完整日志见上方输出。" -ForegroundColor Red
      Write-Host "  ══════════════════════════════════════════════════════" -ForegroundColor Red
      Write-Host ""
      if ($uniLog) {
        Write-Host "  错误摘要（grep Build failed / Could not resolve）：" -ForegroundColor Red
        $uniLog | Select-String -Pattern 'Build failed|Could not resolve|error|ERROR' |
          Select-Object -First 15 | ForEach-Object { Write-Host "    $_" -ForegroundColor Red }
      }
      exit 2
    }
  }
  if (-not $built -and (Test-Path $HbxCli)) {
    try {
      & $HbxCli open | Out-Null
      Start-Sleep -Seconds 3
      & $HbxCli run --project $root --platform app-android --compile true 2>&1 | Tee-Object -Variable log
      Write-Host $log
    } catch {
      Write-Warning "HBuilderX CLI 编译失败: $_"
    }
  }
  # 新鲜度硬校验：既然编了，产物必须比编译开始时间新。
  # 不通过说明 uni build 其实没写盘（输出路径变了 / 编到别处 / 静默跳过）。
  if ($built) {
    $freshOk = $false
    foreach ($c in @("dist\build\app", "dist\build\app-plus", "unpackage\resources\__UNI__F183218\www")) {
      $p = Join-Path $root $c
      $svc = Join-Path $p "app-service.js"
      if (Test-Path $svc) {
        if ((Get-Item $svc).LastWriteTime -ge $buildStarted.AddSeconds(-5)) { $freshOk = $true; break }
      }
    }
    if (-not $freshOk) {
      Write-Host ""
      Write-Host "  ✗ 编译后没有找到本次生成的 app-service.js（全部候选都比编译开始时间旧）" -ForegroundColor Red
      Write-Host "    已中止，避免把旧产物当新包推给用户。" -ForegroundColor Red
      Write-Host ""
      exit 3
    }
  }
} else {
  Write-Host "[1] 跳过编译（-SkipBuild）— 将使用磁盘上现有 www"
}

$pick = Select-BestWww $root
$www = $pick.Path
if ($pick.Score -lt -100) {
  Write-Host ""
  Write-Host "  ✗ 所有候选 www 的指纹校验都不通过（生产地址缺失 / 含内网地址 / 体验模式 / tabsBug）" -ForegroundColor Red
  Write-Host "    已中止：宁可不推，也不推一个会被后端拒绝或行为异常的包。" -ForegroundColor Red
  Write-Host ""
  Write-Error "www 指纹校验失败，拒绝打包"
} elseif ((-not $SkipBuild) -and ($pick.Score -lt 5)) {
  Write-Warning ("www 分数偏低 score={0} path={1}，可能仍是旧资源" -f $pick.Score, $www)
}

if ((-not $www) -or (-not (Test-Path $www))) {
  Write-Error "未找到 www/app-service.js。请先执行 uni build -p app"
}

$svcPath = Join-Path $www "app-service.js"
$svcProbe = Get-Content $svcPath -Raw -ErrorAction SilentlyContinue
Write-Host "[2] www = $www"
Write-Host ("    fingerprint: 39.107={0} 192.168={1} demo={2} tabsBug={3} mtime={4}" -f `
  ($svcProbe -match '39\.107\.120\.55'), `
  ($svcProbe -match '192\.168\.\d+\.\d+'), `
  ($svcProbe -match '体验演示模式'), `
  ($svcProbe -match 'versionTabs:versionTabs'), `
  (Get-Item $svcPath).LastWriteTime)

# 2. 版本：WgtCode = buildCode（versionCode*10000+machineCode）
Write-Host "[3] versionName=$VersionName machine=$($ver.machineCode) wgtCode=$WgtCode note=$Note"

# 把 buildCode 写入 www/manifest.json，热更后 plus.runtime.wgtVersion 与服务端一致
$wwwMf = Join-Path $www "manifest.json"
if (Test-Path $wwwMf) {
  try {
    $mfData = Get-Content $wwwMf -Raw -Encoding UTF8 | ConvertFrom-Json
    if (-not $mfData.version) { $mfData | Add-Member -NotePropertyName version -NotePropertyValue ([pscustomobject]@{}) -Force }
    $mfData.version | Add-Member -NotePropertyName name -NotePropertyValue $VersionName -Force
    $mfData.version | Add-Member -NotePropertyName code -NotePropertyValue ([string]$WgtCode) -Force
    ($mfData | ConvertTo-Json -Depth 20) | Set-Content -Path $wwwMf -Encoding UTF8
    Write-Host "    www manifest version=$VersionName code=$WgtCode"
  } catch {
    Write-Warning "写入 www manifest 版本失败: $($_.Exception.Message)"
  }
}

# 2.5 源码↔产物一致性闸门（最后一道，也是最可靠的一道）
# 原理：不管中间经历了什么，只要拿 src/ 里真实存在的源码字符串去搜产物，
# 搜不到就说明产物不是从当前源码编出来的。
# 这一条能拦住本次事故：uni build 因 import 路径写错而失败，
# 产物停留在 09-21，于是「markRemoved」「trash-src-bar」等标识符全部 MISS。
$mustHave = @('home_library_tab', 'trash-src-bar', 'disposeSource', 'back-to-top')
$svcRaw = [System.IO.File]::ReadAllText($svcPath)
$missing = @()
foreach ($k in $mustHave) { if ($svcRaw -notmatch [regex]::Escape($k)) { $missing += $k } }
if ($missing.Count -gt 0) {
  Write-Host ""
  Write-Host "  ✗✗✗ 产物与源码不一致，拒绝打包 ✗✗✗" -ForegroundColor Red
  Write-Host "    以下关键标识符在 app-service.js 中找不到：" -ForegroundColor Red
  foreach ($m in $missing) { Write-Host "      - $m" -ForegroundColor Red }
  Write-Host "    说明编译产物不是从当前 src/ 编出来的（编译失败后被静默吞掉了）。" -ForegroundColor Red
  Write-Host "    绝不能推送：用户装上去会看不到所有新功能。已中止。" -ForegroundColor Red
  Write-Host ""
  Write-Error "产物缺少关键标识符: $($missing -join ', ')"
}

# 3. 打 zip（wgt）
$outDir = Join-Path $root "dist\release\wgt"
New-Item -ItemType Directory -Force -Path $outDir | Out-Null
$stamp = Get-Date -Format "yyyyMMddHHmmss"
$wgtPath = Join-Path $outDir ("album-sync-{0}-{1}.wgt" -f $WgtCode, $stamp)
if (Test-Path $wgtPath) { Remove-Item $wgtPath -Force }

Write-Host "[4] 压缩 $wgtPath"
Add-Type -AssemblyName System.IO.Compression.FileSystem
[System.IO.Compression.ZipFile]::CreateFromDirectory($www, $wgtPath, [System.IO.Compression.CompressionLevel]::Optimal, $false)
$size = (Get-Item $wgtPath).Length
Write-Host ("    大小: {0} bytes" -f $size)

# 4. 元数据 sidecar
$meta = [ordered]@{
  file         = $wgtPath
  fileName     = Split-Path -Leaf $wgtPath
  type         = "wgt"
  versionCode  = $WgtCode
  versionName  = $VersionName
  wgtVersion   = $WgtCode
  machineCode  = [int]$ver.machineCode
  buildCode    = [int]$WgtCode
  baseVersionCode = [int]$ver.versionCode
  note         = $Note
  size         = $size
  builtAt      = (Get-Date).ToString("s")
  www          = $www
}
$metaPath = $wgtPath + ".json"
$meta | ConvertTo-Json | Set-Content -Path $metaPath -Encoding UTF8
Write-Host "[5] 元数据 $metaPath"
Write-Host ""
Write-Host "WGT 已就绪: $wgtPath"
Write-Host "推送: powershell -File scripts\push-update.ps1 -File $wgtPath -Note $Note"