# pack-latest.ps1 - rebuild latest src and pack offline APK (source-safe)
param(
  [switch]$Install,
  [string]$Serial = '',
  [switch]$SkipImport,
  [switch]$BumpVersion,
  [switch]$NoPrompt,
  [string]$ConfigPath = ''
)
$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}
$scripts = $PSScriptRoot
if (-not $ConfigPath) { $ConfigPath = Join-Path $scripts 'offline-config.json' }

Write-Host '======== pack-latest: rebuild latest source ========' -ForegroundColor Cyan
Write-Host '  src:      live working tree (restored after pack)'
Write-Host '  build:    uni build -p app -> dist/build/app'
Write-Host '  package:  android-offline Gradle assembleRelease'
Write-Host ''

# $args is reserved in PowerShell - use $packArgs
$packArgs = @('-Model', 'base', '-ConfigPath', $ConfigPath)
if ($Install) { $packArgs += '-Install' }
if ($Serial) { $packArgs += @('-Serial', $Serial) }
if ($SkipImport) { $packArgs += '-SkipImport' }
if ($BumpVersion) { $packArgs += '-BumpVersion' }
if ($NoPrompt) { $packArgs += '-NoPrompt' }

& powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $scripts 'pack-offline-apk.ps1') @packArgs
if ($LASTEXITCODE -ne 0) { throw "pack-offline-apk failed exit=$LASTEXITCODE" }

Write-Host ''
Write-Host 'pack-latest done.' -ForegroundColor Green
