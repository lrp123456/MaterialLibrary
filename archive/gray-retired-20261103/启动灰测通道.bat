@echo off
chcp 65001 >nul
setlocal
set "PROJECT_DIR=%~dp0"
set "NODE=C:\Program Files\nodejs\node.exe"
if not exist "%NODE%" set "NODE=node"

echo ============================================
echo   灰测通道 · 构建并启动 (API 30000 / Web 30003)
echo ============================================
echo.
echo  [1/2] 构建 web-pro 到 dist-gray
echo  [2/2] 拉起灰测 API 30000 与灰测 Web 30003
echo.
echo  参数：--no-build 只重启 / --build-only 只构建 / --sync-data 重拉正式库快照
echo.

"%NODE%" "%PROJECT_DIR%scripts\gray-release.js" %*

echo.
echo [OK] 灰测入口 http://127.0.0.1:30003/    正式入口 http://127.0.0.1:30002/
echo      验证通过后，在灰测页面的「系统设置 → 双通道灰度发布」点「发布到正式版」
echo.
pause
endlocal
