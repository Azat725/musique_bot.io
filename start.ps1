# Musique: starts a Cloudflare quick tunnel and the bot + API server on this PC.
# Usage: right-click -> "Run with PowerShell", or double-click start.bat
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot
$env:Path = [Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [Environment]::GetEnvironmentVariable("Path", "User")

$port = 8000
$py = Join-Path $PSScriptRoot ".venv\Scripts\python.exe"

if (-not (Test-Path "server\.env")) {
    Write-Host "Create server\.env from server\.env.example and put BOT_TOKEN there." -ForegroundColor Red
    exit 1
}

if (-not (Test-Path $py)) {
    Write-Host "Creating virtual environment..." -ForegroundColor Cyan
    py -3.12 -m venv .venv
    & $py -m pip install -q --upgrade pip
    & $py -m pip install -q -r server\requirements.txt
}
# YouTube changes often; a fresh yt-dlp keeps extraction working
Write-Host "Updating yt-dlp..." -ForegroundColor Cyan
& $py -m pip install -q -U "yt-dlp[default]"

$cf = (Get-Command cloudflared -ErrorAction SilentlyContinue).Source
if (-not $cf) { $cf = "${env:ProgramFiles(x86)}\cloudflared\cloudflared.exe" }
if (-not (Test-Path $cf)) {
    Write-Host "Installing cloudflared..." -ForegroundColor Cyan
    winget install --id Cloudflare.cloudflared -e --accept-source-agreements --accept-package-agreements --silent
    $cf = "${env:ProgramFiles(x86)}\cloudflared\cloudflared.exe"
}
if (-not (Get-Command ffmpeg -ErrorAction SilentlyContinue)) {
    Write-Host "Installing ffmpeg..." -ForegroundColor Cyan
    winget install --id Gyan.FFmpeg -e --accept-source-agreements --accept-package-agreements --silent
}

$log = Join-Path $PSScriptRoot "tunnel.log"
Remove-Item $log -ErrorAction SilentlyContinue
Write-Host "Starting Cloudflare tunnel..." -ForegroundColor Cyan
$tunnel = Start-Process $cf -ArgumentList "tunnel", "--no-autoupdate", "--url", "http://127.0.0.1:$port" `
    -RedirectStandardError $log -WindowStyle Hidden -PassThru

$url = $null
for ($i = 0; $i -lt 60 -and -not $url; $i++) {
    Start-Sleep -Seconds 1
    if (Test-Path $log) {
        $m = Select-String -Path $log -Pattern "https://[a-z0-9-]+\.trycloudflare\.com" | Select-Object -First 1
        if ($m) { $url = $m.Matches[0].Value }
    }
}
if (-not $url) {
    Stop-Process -Id $tunnel.Id -Force -ErrorAction SilentlyContinue
    Write-Host "Tunnel did not start, see tunnel.log" -ForegroundColor Red
    exit 1
}

Write-Host "Public API: $url" -ForegroundColor Green
Write-Host "Press Ctrl+C to stop." -ForegroundColor DarkGray
$env:PUBLIC_API_URL = $url
$env:PORT = "$port"
try {
    & $py -m server
}
finally {
    Stop-Process -Id $tunnel.Id -Force -ErrorAction SilentlyContinue
}
