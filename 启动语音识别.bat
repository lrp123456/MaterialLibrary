@echo off
chcp 65001 >nul
setlocal
set "PROJECT_DIR=%~dp0"
set "PY=%ASR_PYTHON%"
if "%PY%"=="" set "PY=C:\Users\lrp\.workbuddy\binaries\python\envs\default\Scripts\python.exe"
if not exist "%PY%" (
  echo [ERROR] 找不到 Python: %PY%
  echo         请设置环境变量 ASR_PYTHON 指向带 sherpa-onnx 的 python.exe
  pause
  exit /b 1
)

echo ============================================
echo   本地语音识别 (FunASR · SenseVoice)
echo   HTTP 127.0.0.1:10095   WS 127.0.0.1:10096
echo ============================================
echo   关闭本窗口即停止服务。
echo.

"%PY%" -u "%PROJECT_DIR%scripts\asr\asr_server.py"

echo.
echo [INFO] 语音识别服务已退出。
pause
endlocal
