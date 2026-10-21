@echo off
chcp 65001 >nul
setlocal
set "PROJECT_DIR=%~dp0"
set "NODE=C:\Program Files\nodejs\node.exe"
if not exist "%NODE%" set "NODE=node"
set "PORT=3010"

echo [INFO] 启动剪辑编辑器（带守护：进程挂掉会自动重启）
echo [INFO] 端口 %PORT%  ·  日志 logs\editor-watchdog.log
echo [INFO] 关闭本窗口即停止服务
echo.

cd /d "%PROJECT_DIR%editor"
"%NODE%" watchdog.cjs

echo.
echo [INFO] 守护进程已退出。
pause
endlocal
