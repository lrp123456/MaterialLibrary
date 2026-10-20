@echo off
chcp 65001 >nul
setlocal
set "PROJECT_DIR=%~dp0"
set "NODE=C:\Program Files\nodejs\node.exe"
if not exist "%NODE%" set "NODE=node"
set "PORT=3010"

echo [INFO] 正在启动剪辑编辑器 (OpenCut Classic)...
echo [INFO] 端口 %PORT%  ·  构建产物自动识别
echo.

cd /d "%PROJECT_DIR%editor"
"%NODE%" start.cjs

echo.
echo [INFO] 剪辑编辑器已停止。
pause
endlocal
