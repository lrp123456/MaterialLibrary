@echo off
chcp 65001 >nul
setlocal
set "PROJECT_DIR=%~dp0"
set "NODE=C:\Program Files\nodejs\node.exe"
if not exist "%NODE%" set "NODE=node"
set "PORT=3010"

echo [INFO] 启动剪辑编辑器（带守护：进程挂掉会自动重启）
echo [INFO] 内部端口 %PORT%（勿直接访问）· 统一入口 http://127.0.0.1:30002 · 日志 logs\editor-watchdog.log
echo [INFO] 关闭本窗口即停止服务
echo.

cd /d "%PROJECT_DIR%editor"
"%NODE%" watchdog.cjs

echo.
echo [INFO] 守护进程已退出。
pause
endlocal
