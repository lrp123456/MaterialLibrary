@echo off
chcp 65001 >nul
title Material Library 统一启动控制台

echo [1/2] 正在通过 WSL 启动 material-library-server (端口 30001 & 30002)...
wsl -d smu -e bash -lc "bash /mnt/c/Users/lrp/DevEcoStudioProjects/MaterialLibrary/material-library-server/start.sh start"

echo [2/2] 启动桌面管理控制台 (端口 3790)...
cd /d "%~dp0material-library-server"
start "" node service-hub\launch.js

echo 启动指令已完成，请检查浏览器或控制台面板 (http://127.0.0.1:3790)。
timeout /t 3 >nul
