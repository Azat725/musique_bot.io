# Musique: starts the bot + API server on this PC and publishes it through a tunnel.
# Usage: double-click start.bat, or: powershell -File start.ps1 [-Tunnel ngrok|ssh|cloudflare]
#   ngrok      — static ngrok domain (default when NGROK_DOMAIN is set in server\.env; the address never changes)
#   ssh        — localhost.run over SSH (default otherwise; the address changes, the server updates the menu button)
#   cloudflare — Cloudflare quick tunnel (needs outbound port 7844)
param([ValidateSet("ngrok", "ssh", "cloudflare", "auto")][string]$Tunnel = "auto")

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot
$env:Path = [Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [Environment]::GetEnvironmentVariable("Path", "User")

$port = 8000
$envFile = Get-Content "server\.env" -ErrorAction SilentlyContinue
function Get-EnvValue($name) {
    $line = $envFile | Where-Object { $_ -match "^\s*$name\s*=" } | Select-Object -First 1
    if ($line) { return ($line -replace "^\s*$name\s*=\s*", "").Trim() }
}
$ngrokDomain = Get-EnvValue "NGROK_DOMAIN"
$ngrokToken = Get-EnvValue "NGROK_AUTHTOKEN"
if ($Tunnel -eq "auto") { $Tunnel = if ($ngrokDomain -and $ngrokToken) { "ngrok" } else { "ssh" } }
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

if (-not (Get-Command ffmpeg -ErrorAction SilentlyContinue)) {
    Write-Host "Installing ffmpeg..." -ForegroundColor Cyan
    winget install --id Gyan.FFmpeg -e --accept-source-agreements --accept-package-agreements --silent
}

$env:PORT = "$port"
$tunnelProc = $null

if ($Tunnel -eq "ngrok") {
    if (-not ($ngrokDomain -and $ngrokToken)) {
        Write-Host "Put NGROK_AUTHTOKEN and NGROK_DOMAIN into server\.env." -ForegroundColor Red
        exit 1
    }
    $ngrok = (Get-Command ngrok -ErrorAction SilentlyContinue).Source
    if (-not $ngrok) {
        Write-Host "Installing ngrok..." -ForegroundColor Cyan
        winget install --id Ngrok.Ngrok -e --accept-source-agreements --accept-package-agreements --silent
        $env:Path = [Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [Environment]::GetEnvironmentVariable("Path", "User")
        $ngrok = (Get-Command ngrok -ErrorAction SilentlyContinue).Source
    }
    if (-not $ngrok) { Write-Host "ngrok not found after install; reopen the terminal and retry." -ForegroundColor Red; exit 1 }
    $env:NGROK_AUTHTOKEN = $ngrokToken
    $log = Join-Path $PSScriptRoot "tunnel.log"
    Remove-Item $log -ErrorAction SilentlyContinue
    Write-Host "Starting ngrok tunnel..." -ForegroundColor Cyan
    $tunnelProc = Start-Process $ngrok -ArgumentList "http", "--url=$ngrokDomain", "--log=stdout", "$port" `
        -RedirectStandardOutput $log -WindowStyle Hidden -PassThru
    Start-Sleep -Seconds 4
    if ($tunnelProc.HasExited) {
        Write-Host "ngrok exited: $(Get-Content $log -Raw)" -ForegroundColor Red
        exit 1
    }
    $env:TUNNEL = "none"
    $env:PUBLIC_API_URL = "https://$($ngrokDomain -replace '^https?://', '')"
    Write-Host "Public API: $env:PUBLIC_API_URL" -ForegroundColor Green
}
elseif ($Tunnel -eq "ssh") {
    if (-not (Get-Command ssh -ErrorAction SilentlyContinue)) {
        Write-Host "OpenSSH client not found: Settings > System > Optional features > OpenSSH Client." -ForegroundColor Red
        exit 1
    }
    $env:TUNNEL = "ssh"
    $env:PUBLIC_API_URL = ""
    Write-Host "Starting server with localhost.run tunnel..." -ForegroundColor Cyan
}
else {
    $cf = (Get-Command cloudflared -ErrorAction SilentlyContinue).Source
    if (-not $cf) { $cf = "${env:ProgramFiles(x86)}\cloudflared\cloudflared.exe" }
    if (-not (Test-Path $cf)) {
        Write-Host "Installing cloudflared..." -ForegroundColor Cyan
        winget install --id Cloudflare.cloudflared -e --accept-source-agreements --accept-package-agreements --silent
        $cf = "${env:ProgramFiles(x86)}\cloudflared\cloudflared.exe"
    }
    $log = Join-Path $PSScriptRoot "tunnel.log"
    Remove-Item $log -ErrorAction SilentlyContinue
    Write-Host "Starting Cloudflare tunnel..." -ForegroundColor Cyan
    $tunnelProc = Start-Process $cf -ArgumentList "tunnel", "--no-autoupdate", "--url", "http://127.0.0.1:$port" `
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
        Stop-Process -Id $tunnelProc.Id -Force -ErrorAction SilentlyContinue
        Write-Host "Tunnel did not start, see tunnel.log" -ForegroundColor Red
        exit 1
    }
    Write-Host "Public API: $url" -ForegroundColor Green
    $env:TUNNEL = "none"
    $env:PUBLIC_API_URL = $url
}

Write-Host "Press Ctrl+C to stop." -ForegroundColor DarkGray
try {
    & $py -m server
}
finally {
    if ($tunnelProc) { Stop-Process -Id $tunnelProc.Id -Force -ErrorAction SilentlyContinue }
}
