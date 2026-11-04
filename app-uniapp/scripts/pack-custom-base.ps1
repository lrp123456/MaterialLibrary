# 自定义调试基座（含 uni-local-infer so + JNI jar）
param(
  [string]$PackageName = "lrp.aibum",
  [string]$CertType = "3",
  [switch]$UseExisting,
  [switch]$BumpVersion,
  [switch]$NoPrompt,
  [string]$HbxCli = "C:\Users\lrp\Downloads\HBuilderX\cli.exe"
)
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
if (-not (Test-Path (Join-Path $root "src\manifest.json"))) { $root = (Get-Location).Path }
Set-Location $root
Write-Host "[pack-custom-base] $root  pkg=$PackageName cert=$CertType iscustom=true"
if (-not (Test-Path $HbxCli)) { Write-Error "未找到 HBuilderX cli.exe: $HbxCli" }
$so = Join-Path $root "nativeplugins\uni-local-infer\android\libs\arm64-v8a\liblocalinfer.so"
$jar = Join-Path $root "nativeplugins\uni-local-infer\android\libs\uni-local-infer.jar"
Write-Host "[check] so=$(Test-Path $so) jar=$(Test-Path $jar)"
# 版本策略：是否抬版本交互询问；机器号每次出包 +1
$verScript = Join-Path $root "scripts\version-bump.ps1"
$verArgs = @()
if ($BumpVersion) { $verArgs += "-BumpVersion" }
if ($NoPrompt) { $verArgs += "-NoPrompt" }
$verOut = & powershell -NoProfile -ExecutionPolicy Bypass -File $verScript @verArgs
if ($LASTEXITCODE -ne 0) { throw "version-bump failed exit=$LASTEXITCODE" }
$verLine = ($verOut | Where-Object { "$_" -like '@VER@*' } | Select-Object -Last 1)
if (-not $verLine) { throw "version-bump no output" }
$ver = ($verLine.Substring(5) | ConvertFrom-Json)
$versionName = $ver.versionName
$versionCode = [int]$ver.buildCode
$outDir = Join-Path $root "dist\release\apk"
New-Item -ItemType Directory -Force -Path $outDir | Out-Null
$apk = $null
$packStart = Get-Date
$packLog = New-Object System.Collections.Generic.List[string]
if (-not $UseExisting) {
  Write-Host "[1] 云打包自定义调试基座（需已登录 DCloud）..."
  & $HbxCli open | Out-Null
  Start-Sleep -Seconds 4
  $cliArgs = @("pack","--project",$root,"--platform","android","--iscustom","true","--safemode","true","--android.packagename",$PackageName,"--android.androidpacktype",$CertType)
  Write-Host "    cli $($cliArgs -join ' ')"
  & $HbxCli @cliArgs 2>&1 | ForEach-Object {
    $line = "$_"
    $packLog.Add($line)
    Write-Host $line
  }
  Start-Sleep -Seconds 3
  $joined = ($packLog -join "`n")
  if ($joined -match '不合法|打包失败|失败：|cloud pack failed') {
    Write-Error "云打包失败，拒绝使用旧 APK。请看上方 HBuilderX 日志。"
  }
}
Write-Host "[2] 查找 APK..."
foreach ($dir in @((Join-Path $root "dist\debug"),(Join-Path $root "unpackage\debug"),(Join-Path $root "unpackage\release"),(Join-Path $root "dist\cache\apk"),$outDir)) {
  if (-not (Test-Path $dir)) { continue }
  $hit = Get-ChildItem $dir -Filter *.apk -Recurse -ErrorAction SilentlyContinue |
    Where-Object { $_.LastWriteTime -ge $packStart.AddMinutes(-2) } |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1
  if ($hit) { $apk = $hit; break }
}
if (-not $apk) { Write-Error "未找到本次新打的 APK。请在已打开的 HBuilder 打包框点「打包」，完成后重跑 -UseExisting" }
$stamp = Get-Date -Format "yyyyMMddHHmmss"
$final = Join-Path $outDir ("album-sync-custombase-{0}-{1}-{2}.apk" -f $versionName, $versionCode, $stamp)
Copy-Item $apk.FullName $final -Force
Write-Host "[3] $($final)  ($([math]::Round((Get-Item $final).Length/1MB,2)) MB)"
Write-Host "来源 $($apk.FullName)"
