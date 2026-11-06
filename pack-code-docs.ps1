# =====================================================================
# 一键打包：仓库全部代码 + docs（排除依赖 / 构建产物 / 大二进制 / 数据）
# 用法（在仓库根目录的 PowerShell 中）：
#   .\pack-code-docs.ps1                 # 默认输出 code_docs_review.zip
#   .\pack-code-docs.ps1 -Out x.zip      # 自定义输出名
# 打的是当前工作区快照（含未提交改动），不是某个 git 提交。
# =====================================================================
[CmdletBinding()]
param(
    [string]$Out = 'code_docs_review.zip'
)

$ErrorActionPreference = 'Stop'
Set-Location -Path $PSScriptRoot

$outPath = Join-Path $PSScriptRoot $Out
if (Test-Path $outPath) { Remove-Item $outPath -Force }

# ---- 要打包的代码目录 ----
$codeDirs = @(
    'src', 'web-pro', 'web', 'app-uniapp', 'editor', 'harmony', 'shared',
    'scripts', 'test', 'service-hub', 'pack-studio', 'skills', 'tools', 'docs'
)

# ---- 要打包的根目录代码 / 配置文件（存在才加，避免 bsdtar 空名报错）----
$maybeRoot = @(
    'package.json', 'package-lock.json', 'index.js', 'server.js', 'start.sh',
    '.gitignore', '.env.example', 'README.md', 'DESIGN.md', 'CONTEXT.md',
    'AGENT_RULES.md', 'cordis.patch.yml', 'dsh-plugin.json',
    'android-so-guide.html', 'local-infer-demo.html'
)
$rootFiles = @($maybeRoot | Where-Object { Test-Path $_ })
$rootFiles += @(Get-ChildItem -File -Filter '_test_*.js'     | Select-Object -ExpandProperty Name)
$rootFiles += @(Get-ChildItem -File -Filter '*.bat'         | Select-Object -ExpandProperty Name)
$rootFiles  = @($rootFiles | Select-Object -Unique)

# ---- 排除规则：依赖 / 构建缓存 / 大二进制 / 运行时数据 ----
$excludes = @(
    '--exclude=node_modules', '--exclude=.git', '--exclude=oh_modules', '--exclude=uni_modules',
    '--exclude=unpackage', '--exclude=dist', '--exclude=dist-*', '--exclude=build', '--exclude=target',
    '--exclude=.cxx', '--exclude=__pycache__', '--exclude=.esbuild-tmp', '--exclude=.tmp-esbuild',
    '--exclude=logs', '--exclude=.vscode', '--exclude=cache', '--exclude=.cache', '--exclude=.gradle',
    '--exclude=state', '--exclude=.workbuddy', '--exclude=.agents', '--exclude=.quarkclouddrive',
    '--exclude=test_data', '--exclude=archive', '--exclude=.next', '--exclude=.next-build*',
    '--exclude=.turbo', '--exclude=out', '--exclude=models', '--exclude=assets-3d', '--exclude=*.glb',
    '--exclude=*.gltf', '--exclude=*.mp4', '--exclude=*.zip', '--exclude=*.log', '--exclude=.env',
    '--exclude=*.pyc', '--exclude=*.tsbuildinfo'
)

Write-Host ">> 正在打包代码与 docs ..." -ForegroundColor Cyan
$tarArgs = @('-a', '-cf', $outPath) + $excludes + $codeDirs + $rootFiles
& tar.exe @tarArgs
if ($LASTEXITCODE -ne 0) { throw "tar 打包失败（exit=$LASTEXITCODE）" }

# ---- 完整性校验 ----
& tar.exe -tf $outPath > $null 2>&1
if ($LASTEXITCODE -ne 0) { throw "压缩包完整性校验失败" }

$item = Get-Item $outPath
Write-Host ("`n[完成] {0}  ({1:N2} MB)" -f $item.FullName, ($item.Length / 1MB)) -ForegroundColor Green
