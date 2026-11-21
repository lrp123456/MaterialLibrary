@echo off
chcp 65001 >nul
title Material Library 测试端启动控制台 (Monorepo Worktree)

echo [1/2] 正在通过 WSL 启动测试端 API 与 Web 服务 (端口 30000 ^& 30003)...
wsl -d smu -e bash -lc "ML_PORT=30000 WEB_PRO_PORT=30003 ML_DATA_DIR=/home/lrp/.dsh-material-library-test bash /mnt/c/Users/lrp/DevEcoStudioProjects/MaterialLibrary-test/apps/api/start.sh start"

echo [2/2] 启动桌面管理与异常诊断控制台 (端口 3790)...
cd /d "%~dp0apps\ops-hub"
start "" node launch.js

echo 测试端启动指令已完成，请检查浏览器或控制台面板 (http://127.0.0.1:3790)。
timeout /t 3 >nul
