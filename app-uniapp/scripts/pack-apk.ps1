# pack-apk.ps1 - stub. Full pack: scripts\pack-latest.ps1
param(
  [switch]$Install,
  [string]$Serial = '',
  [switch]$SkipImport,
  [switch]$BumpVersion,
  [switch]$NoPrompt
)
$ErrorActionPreference = 'Stop'
Write-Host 'pack-apk.ps1 is a stub. Forwarding to pack-latest.ps1 ...'
$forward = @()
if ($Install) { $forward += '-Install' }
if ($Serial) { $forward += @('-Serial', $Serial) }
if ($SkipImport) { $forward += '-SkipImport' }
if ($BumpVersion) { $forward += '-BumpVersion' }
if ($NoPrompt) { $forward += '-NoPrompt' }
& powershell -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'pack-latest.ps1') @forward
exit $LASTEXITCODE
