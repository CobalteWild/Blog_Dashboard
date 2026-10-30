# 本地启动博客后台
# 用法：右键 -> 使用 PowerShell 运行，或在本目录执行 .\start-admin.ps1
# 可选：.\start-admin.ps1 -NoBrowser   只起服务，不自动打开浏览器
#       .\start-admin.ps1 -Port 8770   换端口（8765 被占用时）

param(
    [switch]$NoBrowser,
    [int]$Port = 8765
)

$ErrorActionPreference = 'Stop'

$root = Join-Path $PSScriptRoot 'admin'
if (-not (Test-Path $root)) {
    Write-Host "找不到 admin 目录：$root" -ForegroundColor Red
    exit 1
}

$py = Get-Command python -ErrorAction SilentlyContinue
if (-not $py) {
    Write-Host ""
    Write-Host "  没有找到 python。" -ForegroundColor Red
    Write-Host "  请先安装 Python 3：https://www.python.org/downloads/" -ForegroundColor Yellow
    Write-Host "  或者改用其他静态服务器（见 README 第 4 节）" -ForegroundColor Yellow
    Write-Host ""
    exit 1
}

$url = "http://127.0.0.1:$Port/"
Write-Host ""
Write-Host "  博客后台已启动" -ForegroundColor Green
Write-Host "  地址：$url"
Write-Host "  按 Ctrl+C 停止"
Write-Host ""

if (-not $NoBrowser) { Start-Process $url }

python -m http.server $Port --bind 127.0.0.1 --directory $root