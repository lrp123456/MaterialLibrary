@echo off
chcp 65001 >nul
setlocal
set "PROJECT_DIR=%~dp0"
set "NODE=C:\Program Files\nodejs\node.exe"
if not exist "%NODE%" set "NODE=node"

echo ============================================
echo   test 分支通道 · 构建并启动 (API 30000 / Web 30003)
echo ============================================
echo.
echo   代码来源：..\MaterialLibraryServer-test  ^(test 分支工作树^)
echo   数据目录：%USERPROFILE%\.dsh-material-library-test
echo   正式通道：30001 / 30002 不受影响，可同时运行
echo.
echo   参数：--no-build 只重启 ^| --build-only 只构建 ^| --sync-data 重拉正式库快照
echo.

"%NODE%" "%PROJECT_DIR%scripts\branch-channel.js" --start test %*

echo.
echo [OK] test 入口 http://127.0.0.1:30003/    正式入口 http://127.0.0.1:30002/
echo      验证通过后在项目根执行「合并test到master.bat」同步到正式版
echo.
pause
endlocal
