@echo off
chcp 65001 >nul
setlocal
set "PROJECT_DIR=%~dp0"
set "NODE=C:\Program Files\nodejs\node.exe"
if not exist "%NODE%" set "NODE=node"

echo ============================================
echo   test -^> master 合并发布
echo ============================================
echo.
echo   这一步会：合并 test 到 master -^> 重建正式前端产物 -^> 重启 30001/30002
echo   前提：master 工作树必须是干净的 ^(没有未提交改动^)，否则 git merge 会被拒绝
echo.

"%NODE%" "%PROJECT_DIR%scripts\branch-channel.js" --promote test --dry-run

echo.
echo --------------------------------------------
echo   以上是合并预演，尚未改动任何代码。
echo --------------------------------------------
choice /C YN /N /M "确认执行合并并重建正式版？(Y/N) "
if errorlevel 2 goto :cancel

echo.
"%NODE%" "%PROJECT_DIR%scripts\branch-channel.js" --promote test
goto :done

:cancel
echo.
echo [CANCEL] 已取消，未做任何改动。

:done
echo.
pause
endlocal
