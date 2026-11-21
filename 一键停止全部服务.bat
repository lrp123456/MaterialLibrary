@echo off
chcp 65001 >nul
title Material Library 停止全部服务

echo 正在停止正式端服务 (端口 30001 ^& 30002)...
wsl -d smu -e bash -lc "bash /mnt/c/Users/lrp/DevEcoStudioProjects/MaterialLibrary/apps/api/start.sh stop"

echo 正在停止测试端服务 (端口 30000 ^& 30003)...
wsl -d smu -e bash -lc "ML_PORT=30000 WEB_PRO_PORT=30003 ML_DATA_DIR=/home/lrp/.dsh-material-library-test bash /mnt/c/Users/lrp/DevEcoStudioProjects/MaterialLibrary-test/apps/api/start.sh stop"

echo 正在停止服务控制台 (端口 3790)...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":3790" ^| findstr "LISTENING"') do taskkill /f /pid %%a >nul 2>&1

echo 全部服务已停止。
timeout /t 3 >nul
