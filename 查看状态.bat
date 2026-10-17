@echo off
chcp 65001 >nul
setlocal
set WSL_DISTRO=smu
echo [状态] 素材库与伴生服务
echo ----------------------------------------
echo [1] 端口探活 (从 Windows)
powershell -NoProfile -Command "$ports=@(30001,4000,5432,6379,7890); foreach($p in $ports){ $c=New-Object Net.Sockets.TcpClient; try{ $r=$c.BeginConnect('127.0.0.1',$p,$null,$null); $ok=$r.AsyncWaitHandle.WaitOne(1200,$false); if($ok -and $c.Connected){ Write-Host ('  {0,-6} UP' -f $p) } else { Write-Host ('  {0,-6} DOWN' -f $p) } } catch { Write-Host ('  {0,-6} DOWN' -f $p) } finally { $c.Close() } }"
echo.
echo [2] WSL 进程
wsl -d %WSL_DISTRO% -e bash -lc "ps aux | grep -E 'watchdog.sh|node server.js' | grep -v grep || echo '  (无 watchdog/server 进程)'"
echo.
echo [3] Docker 伴生
wsl -d %WSL_DISTRO% -e bash -lc "docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}' 2>/dev/null | grep -E 'NAMES|sm-' || echo docker不可用"
echo.
echo [4] 最近日志
wsl -d %WSL_DISTRO% -e bash -lc "tail -8 /home/lrp/.dsh-material-library/server.log 2>/dev/null || echo 无日志"
echo ----------------------------------------
echo 管理台: http://127.0.0.1:30001/#/
pause
endlocal
