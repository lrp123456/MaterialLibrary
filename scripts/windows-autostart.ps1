# ==============================================================================
# 素材库 Windows 开机自启动脚本 (UTF-8 with BOM)
# 任务计划程序 / 启动项调用入口：确保 WSL、Docker 伴生容器、素材库主服务可用
# ==============================================================================
$ErrorActionPreference = 'Continue'

$WslDistro   = $env:ML_WSL_DISTRO
if (-not $WslDistro) { $WslDistro = 'smu' }

$WinProject  = 'C:\Users\lrp\DevEcoStudioProjects\MaterialLibraryServer'
$WslProject  = '/mnt/c/Users/lrp/DevEcoStudioProjects/MaterialLibraryServer'
$DataDir     = '/home/lrp/.dsh-material-library'
$Port        = 30001
$LogFile     = Join-Path $env:USERPROFILE '.dsh-material-library\windows-autostart.log'
$LogDir      = Split-Path $LogFile -Parent
if (-not (Test-Path $LogDir)) { New-Item -ItemType Directory -Path $LogDir -Force | Out-Null }

function Write-Log([string]$Msg) {
    $line = "[{0}] {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Msg
    Add-Content -Path $LogFile -Value $line -Encoding UTF8
    Write-Host $line
}

function Invoke-Wsl {
    param([string]$BashCmd, [int]$TimeoutSec = 120)
    $env:WSL_UTF8 = '1'
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = 'wsl.exe'
    $psi.Arguments = "-d $WslDistro -e bash -lc `"$BashCmd`""
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError  = $true
    $psi.UseShellExecute = $false
    $psi.CreateNoWindow = $true
    $p = [System.Diagnostics.Process]::Start($psi)
    if (-not $p.WaitForExit($TimeoutSec * 1000)) {
        try { $p.Kill() } catch {}
        return @{ ExitCode = -1; StdOut = ''; StdErr = 'timeout' }
    }
    return @{
        ExitCode = $p.ExitCode
        StdOut   = $p.StandardOutput.ReadToEnd()
        StdErr   = $p.StandardError.ReadToEnd()
    }
}

function Test-Port([int]$PortNumber, [string]$HostAddr = '127.0.0.1') {
    try {
        $c = New-Object System.Net.Sockets.TcpClient
        $r = $c.BeginConnect($HostAddr, $PortNumber, $null, $null)
        $ok = $r.AsyncWaitHandle.WaitOne(1500, $false)
        if ($ok -and $c.Connected) { $c.Close(); return $true }
        $c.Close()
        return $false
    } catch { return $false }
}

Write-Log "==== 自启动开始 distro=$WslDistro port=$Port ===="

# 0) 确保局域网网络为 Private，放行 30001 防火墙
try {
    # 通过局域网 IPv4 匹配物理网卡
    $lanIp = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object { $_.IPAddress -like '192.168.*' } | Select-Object -First 1
    if ($lanIp) {
        $prof = Get-NetConnectionProfile -InterfaceIndex $lanIp.InterfaceIndex -ErrorAction SilentlyContinue
        if ($prof -and $prof.NetworkCategory -ne 'Private') {
            Set-NetConnectionProfile -InterfaceIndex $lanIp.InterfaceIndex -NetworkCategory Private -ErrorAction SilentlyContinue
            Write-Log "已将局域网物理接口设为 Private"
        }
    }
    # 确保 30001/30002 端口入站规则开启（30002 = web-pro 工作台 + /editor 剪辑页入口）
    if (-not (Get-NetFirewallRule -DisplayName 'MaterialLibrary-30001' -ErrorAction SilentlyContinue)) {
        New-NetFirewallRule -DisplayName 'MaterialLibrary-30001' -Direction Inbound -LocalPort 30001 -Protocol TCP -Action Allow | Out-Null
        Write-Log "已创建防火墙规则 MaterialLibrary-30001"
    } else {
        Set-NetFirewallRule -DisplayName 'MaterialLibrary-30001' -Enabled True -Action Allow -ErrorAction SilentlyContinue | Out-Null
    }
    if (-not (Get-NetFirewallRule -DisplayName 'MaterialLibrary-30002' -ErrorAction SilentlyContinue)) {
        New-NetFirewallRule -DisplayName 'MaterialLibrary-30002' -Direction Inbound -LocalPort 30002 -Protocol TCP -Action Allow | Out-Null
        Write-Log "已创建防火墙规则 MaterialLibrary-30002"
    } else {
        Set-NetFirewallRule -DisplayName 'MaterialLibrary-30002' -Enabled True -Action Allow -ErrorAction SilentlyContinue | Out-Null
    }
} catch {
    Write-Log ("网络与防火墙初始化异常: " + $_.Exception.Message)
}

# 1) 确保 WSL 可用
try {
    $wslOk = Invoke-Wsl "echo ok" -TimeoutSec 30
    if ($wslOk.StdOut -notmatch 'ok') {
        Write-Log "WSL 未就绪，尝试唤醒..."
        Start-Process -FilePath 'wsl.exe' -ArgumentList "-d $WslDistro -e true" -WindowStyle Hidden | Out-Null
        Start-Sleep -Seconds 5
    }
    Write-Log "WSL 发行版 $WslDistro 就绪"
} catch {
    Write-Log "WSL 检测失败: $_"
}

# 2) 确保 Docker 伴生容器
try {
    $d = Invoke-Wsl "bash $WslProject/scripts/ensure-docker-companions.sh" -TimeoutSec 90
    Write-Log ("Docker 伴生: " + (($d.StdOut + ' ' + $d.StdErr) -replace "`r?`n", ' | ').Trim())
} catch {
    Write-Log "Docker 伴生启动失败: $_"
}

# 3) 启动素材库主服务（watchdog + server.js）
if (Test-Port $Port) {
    Write-Log "端口 $Port 已在监听，跳过启动"
} else {
    Write-Log "端口 $Port 未监听，启动 start.sh..."
    try {
        $s = Invoke-Wsl "bash $WslProject/start.sh start" -TimeoutSec 30
        Write-Log ("start.sh 启动输出: " + ($s.StdOut -replace "`r?`n", ' ').Trim())
    } catch {
        Write-Log "服务启动异常: $_"
    }

    # 等待就绪
    $ready = $false
    for ($i = 1; $i -le 20; $i++) {
        Start-Sleep -Seconds 2
        if (Test-Port $Port) { $ready = $true; break }
    }
    if ($ready) {
        Write-Log "素材库服务已就绪: http://127.0.0.1:$Port"
    } else {
        Write-Log "素材库服务启动超时，最近日志:"
        try {
            $lg = Invoke-Wsl "tail -20 $DataDir/server.log 2>/dev/null; echo '---'; tail -10 $DataDir/watchdog.log 2>/dev/null" -TimeoutSec 15
            Write-Log ($lg.StdOut -replace "`r?`n", ' | ')
        } catch {}
    }
}

# 3b) 启动 Web 工作台网关（LOGIC-001：30002 归 web-pro/server.cjs 常驻，
#     提供 web-pro 静态资源 + /editor-api 反代 30001 + /editor 反代 Next:3010）
if (Test-Port 30002) {
    Write-Log "端口 30002 已在监听，跳过 web-h5 启动"
} else {
    Write-Log "端口 30002 未监听，启动 web-pro/server.cjs..."
    try {
        $w = Invoke-Wsl "cd $WslProject/web-pro && nohup node server.cjs 30002 >> $DataDir/webpro.log 2>&1 & echo started" -TimeoutSec 20
        Write-Log ("web-h5 启动输出: " + ($w.StdOut + ' ' + $w.StdErr).Trim())
    } catch {
        Write-Log "web-h5 启动异常: $_"
    }
    $webReady = $false
    for ($i = 1; $i -le 10; $i++) {
        Start-Sleep -Seconds 2
        if (Test-Port 30002) { $webReady = $true; break }
    }
    if ($webReady) {
        Write-Log "Web 工作台已就绪: http://127.0.0.1:30002"
    } else {
        Write-Log "Web 工作台启动超时，最近日志:"
        try {
            $lg2 = Invoke-Wsl "tail -20 $DataDir/webpro.log 2>/dev/null" -TimeoutSec 15
            Write-Log ($lg2.StdOut -replace "`r?`n", ' | ')
        } catch {}
    }
}

# 4) 探活汇总
$checks = @(
    @{ Name = 'material-library-local'; Port = $Port; Host = '127.0.0.1' },
    @{ Name = 'web-pro-gateway';        Port = 30002; Host = '127.0.0.1' },
    @{ Name = 'litellm';                Port = 4000;  Host = '127.0.0.1' },
    @{ Name = 'postgres';               Port = 5432;  Host = '127.0.0.1' },
    @{ Name = 'redis';                  Port = 6379;  Host = '127.0.0.1' },
    @{ Name = 'http-proxy';             Port = 7890;  Host = '127.0.0.1' }
)
foreach ($c in $checks) {
    $up = Test-Port -PortNumber $c.Port -HostAddr $c.Host
    Write-Log ("探活 {0}:{1} => {2}" -f $c.Name, $c.Port, $(if ($up) { 'UP' } else { 'DOWN' }))
}

# 5) 局域网真机入口探活验证
try {
    $lanResp = Invoke-RestMethod -Uri "http://192.168.1.59:$Port/api/health" -TimeoutSec 3 -ErrorAction Stop
    Write-Log ("局域网真机入口 192.168.1.59:$Port 探活通过: ok=$($lanResp.ok)")
} catch {
    Write-Log ("局域网真机入口 192.168.1.59:$Port 探活异常: " + $_.Exception.Message)
}

Write-Log "==== 自启动完成 ===="
exit 0
