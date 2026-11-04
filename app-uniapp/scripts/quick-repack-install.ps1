# quick-repack-install.ps1 - legacy name, forwards to pack-latest.ps1
param(
  [switch]$Install,
  [string]$Serial = '',
  [switch]$SkipImport,
  [switch]$BumpVersion,
  [switch]$NoPrompt,
  [string]$ConfigPath = ''
)
$ErrorActionPreference = 'Stop'
$scripts = $PSScriptRoot
$forward = @()
if ($Install) { $forward += '-Install' }
if ($Serial) { $forward += @('-Serial', $Serial) }
if ($SkipImport) { $forward += '-SkipImport' }
if ($BumpVersion) { $forward += '-BumpVersion' }
if ($NoPrompt) { $forward += '-NoPrompt' }
if ($ConfigPath) { $forward += @('-ConfigPath', $ConfigPath) }

& powershell -ExecutionPolicy Bypass -File (Join-Path $scripts 'pack-latest.ps1') @forward
exit $LASTEXITCODE
