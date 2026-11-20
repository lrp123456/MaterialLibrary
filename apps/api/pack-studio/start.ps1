# 启动 Pack Studio（可视化打包台）
# 双击或: powershell -File pack-studio\start.ps1
$ErrorActionPreference = 'Stop'
$dir = Split-Path -Parent $MyInvocation.MyCommand.Path
Write-Host "启动 Pack Studio: http://127.0.0.1:3789"
Write-Host "关闭窗口或 Ctrl+C 停止"
node (Join-Path $dir 'server.js')
