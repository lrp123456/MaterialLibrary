@echo off
chcp 65001 >nul
setlocal
set "PROJECT_DIR=%~dp0"
set "NODE=C:\Program Files\nodejs\node.exe"
if not exist "%NODE%" set "NODE=node"

echo [INFO] 正在停止 test 分支通道 (30000 / 30003)...
"%NODE%" "%PROJECT_DIR%scripts\branch-channel.js" --stop test

echo.
pause
endlocal
