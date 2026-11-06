@echo off
rem One-click pack: all code + docs (excludes deps / build output / binaries / data)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0pack-code-docs.ps1"
echo.
pause
