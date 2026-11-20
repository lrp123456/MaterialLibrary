# pack-and-push-apk.ps1 - stub. Full flow: pack-and-push-offline-apk.ps1
param(
  [string]$Note = 'offline apk',
  [string]$Channel = 'internal',
  [switch]$BumpVersion,
  [switch]$NoPrompt
)
$ErrorActionPreference = 'Stop'
Write-Host 'pack-and-push-apk.ps1 is a stub. Forwarding to pack-and-push-offline-apk.ps1 ...'
$forward = @('-Note', $Note, '-Channel', $Channel)
if ($BumpVersion) { $forward += '-BumpVersion' }
if ($NoPrompt) { $forward += '-NoPrompt' }
& powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'pack-and-push-offline-apk.ps1') @forward
exit $LASTEXITCODE
