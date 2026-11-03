# 下载 ncnn Android 预编译并解压到 third_party/ncnn-android
# 用法: powershell -File scripts/fetch_ncnn_android.ps1
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$dest = Join-Path $root 'AlbumSyncUniAppX/native/third_party/ncnn-android'
# 若在 MaterialLibraryServer 目录跑：
if (-not (Test-Path (Join-Path $root 'AlbumSyncUniAppX'))) {
  $root = 'C:\Users\lrp\DevEcoStudioProjects'
  $dest = Join-Path $root 'AlbumSyncUniAppX/native/third_party/ncnn-android'
}
New-Item -ItemType Directory -Force -Path $dest | Out-Null
$url = 'https://github.com/Tencent/ncnn/releases/download/20240410/ncnn-20240410-android-vulkan.zip'
$zip = Join-Path $env:TEMP 'ncnn-android-vulkan.zip'
Write-Host "Downloading $url"
Invoke-WebRequest -Uri $url -OutFile $zip -TimeoutSec 300
Write-Host "Extract to $dest"
if (Test-Path $dest) { Remove-Item "$dest\*" -Recurse -Force -ErrorAction SilentlyContinue }
Expand-Archive $zip $dest -Force
Get-ChildItem $dest | Select-Object Name
Get-ChildItem $dest -Recurse -Filter libncnn.a | Select-Object FullName,Length
