@echo off
chcp 65001 >nul
setlocal
set PROJECT_DIR=%~dp0
echo [INFO] 正在启动室内设计素材库 (WSL/smu)...
powershell -NoProfile -ExecutionPolicy Bypass -File "%PROJECT_DIR%scripts\windows-autostart.ps1"
echo.
echo [OK] 若端口 30001 已就绪，请访问 http://127.0.0.1:30001/#/
endlocal
