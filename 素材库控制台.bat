@echo off
chcp 65001 >nul
title 素材库控制台 (Service Hub 3790)
REM ============================================================
REM 唯一服务控制入口：启动/打开 Service Hub 控制台
REM   正式端 30001/30002（WSL）、test 通道 30000/30003、
REM   Pack Studio 3789、剪辑器、语音识别、合并发布全部在面板操作
REM 已在运行时只打开浏览器，不会重复拉起。
REM ============================================================
set "NODE=C:\Program Files\nodejs\node.exe"
if not exist "%NODE%" set "NODE=node"
"%NODE%" "%~dp0service-hub\launch.js"
if errorlevel 1 pause
