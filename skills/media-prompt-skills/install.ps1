# install.ps1 - 安装 media-prompt-skills 提示词优化套件
# 用法（在 media-prompt-skills 目录下）：
#   powershell -ExecutionPolicy Bypass -File .\install.ps1

$ErrorActionPreference = 'Stop'

$target = Join-Path $env:USERPROFILE '.workbuddy\skills'
# 备份必须放在 skills 目录之外，否则被备份的 SKILL.md 会被当成重复技能扫描
$backup = Join-Path $env:USERPROFILE '.workbuddy\_skill-backups'
$stamp  = Get-Date -Format 'yyyyMMdd-HHmmss'
$src    = $PSScriptRoot

Write-Host ""
Write-Host "=== media-prompt-skills 安装 ===" -ForegroundColor Cyan
Write-Host "源目录: $src"
Write-Host "目标目录: $target"
Write-Host "备份目录: $backup"
Write-Host ""

if (-not (Test-Path $target)) {
    New-Item -ItemType Directory -Path $target -Force | Out-Null
    Write-Host "[创建] 目标目录不存在，已新建" -ForegroundColor Yellow
}
if (-not (Test-Path $backup)) {
    New-Item -ItemType Directory -Path $backup -Force | Out-Null
}

$skills = @(
    'media-prompt-gateway',
    'pe-seedance25',
    'pe-seedance20',
    'pe-seedream5-pro',
    'pe-seedream5-lite',
    'pe-agnes-text',
    'pe-agnes-image',
    'pe-agnes-video',
    'pe-gemini-image',
    'pe-veo',
    'pe-gemini-omni',
    'pe-lyria-music'
)

$ok = 0
$failed = @()

foreach ($s in $skills) {
    $from = Join-Path $src $s
    $to   = Join-Path $target $s

    if (-not (Test-Path (Join-Path $from 'SKILL.md'))) {
        Write-Host "[跳过] $s : 源目录缺少 SKILL.md" -ForegroundColor Red
        $failed += $s
        continue
    }

    try {
        if (Test-Path $to) {
            $bak = Join-Path $backup "$s.bak-$stamp"
            Move-Item -Path $to -Destination $bak -Force
            Write-Host "[备份] $s -> $bak" -ForegroundColor DarkYellow
        }
        Copy-Item -Path $from -Destination $to -Recurse -Force
        Write-Host "[安装] $s" -ForegroundColor Green
        $ok++
    } catch {
        Write-Host "[失败] $s : $($_.Exception.Message)" -ForegroundColor Red
        $failed += $s
    }
}

Write-Host ""
Write-Host "=== 结果 ===" -ForegroundColor Cyan
Write-Host "成功: $ok / $($skills.Count)"
if ($failed.Count -gt 0) {
    Write-Host "失败: $($failed -join ', ')" -ForegroundColor Red
}
Write-Host ""
Write-Host "下一步：新开一个会话，然后说「帮我优化 Seedance 2.5 的提示词：xxx」验证。" -ForegroundColor Cyan
Write-Host "（技能列表在会话启动时加载，旧会话不会热更新）" -ForegroundColor DarkGray
Write-Host ""
