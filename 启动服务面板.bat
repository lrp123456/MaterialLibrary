@echo off
title Service Hub
set "NODE=C:\Program Files\nodejs\node.exe"
if not exist "%NODE%" set "NODE=node"
"%NODE%" "%~dp0service-hub\launch.js"
if errorlevel 1 pause
