@echo off
chcp 65001 >nul
setlocal
set "PROJECT_DIR=%~dp0"
set "NODE=C:\Program Files\nodejs\node.exe"
if not exist "%NODE%" set "NODE=node"

"%NODE%" "%PROJECT_DIR%scripts\branch-channel.js" --status

echo   看分支差异： node scripts\branch-channel.js --diff test
echo   合并建议：   node scripts\branch-channel.js --promote test --dry-run   ^(只预演，不动代码^)
echo.
pause
endlocal
