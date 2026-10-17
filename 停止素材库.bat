@echo off
REM ==============================================================================
REM 一键停止素材库服务与 watchdog
REM ==============================================================================
chcp 65001 >nul
setlocal

cd /d "%~dp0"

set "WSL_DISTRO=smu"
set "PROJECT_DIR=%cd%"

for /f "usebackq delims=" %%i in (`wsl -d %WSL_DISTRO% wslpath -a "%PROJECT_DIR%" 2^>nul`) do set "WSL_DIR=%%i"
if not defined WSL_DIR (
    set "WSL_DIR=/mnt/c/Users/lrp/DevEcoStudioProjects/MaterialLibraryServer"
)

set "START_SH=%WSL_DIR%/start.sh"

echo ============================================
echo   室内设计素材库 · 一键停止
echo ============================================
echo.

wsl -d %WSL_DISTRO% -e bash -lc "bash '%START_SH%' stop"
set "RC=%ERRORLEVEL%"

echo.
if "%RC%"=="0" (
    echo [OK] 已停止。
) else (
    echo [DONE] 停止流程结束（详见上方输出）。
)

echo.
pause
exit /b %RC%
