@echo off
rem 由计划任务调用，前台运行守护进程；shutdown 逻辑交给 watchdog.cjs
chcp 65001 >nul
cd /d "%~dp0"
set "NODE=C:\Program Files\nodejs\node.exe"
if not exist "%NODE%" set "NODE=node"
"%NODE%" watchdog.cjs
