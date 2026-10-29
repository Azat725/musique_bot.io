# Musique DEV: test bot + local server + Cloudflare quick tunnel. Production (VPS, @musiqueenbot) is not touched.
# Usage: powershell -File dev.ps1 [-Tunnel ssh|cloudflare]      (needs server\.env.dev with the TEST bot token)
# The frontend is served by this server from the CURRENT git branch's docs\ at <tunnel>/app/ (no GitHub Pages).
param([ValidateSet("ssh", "cloudflare")][string]$Tunnel = "ssh")

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot
$env:Path = [Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [Environment]::GetEnvironmentVariable("Path", "User")

function Get-EnvValue($file, $name) {
    $line = Get-Content $file -ErrorAction SilentlyContinue | Where-Object { $_ -match "^\s*$name\s*=" } | Select-Object -First 1
    if ($line) { return ($line -replace "^\s*$name\s*=\s*", "").Trim() }
}

$devEnv = Join-Path $PSScriptRoot "server\.env.dev"
if (-not (Test-Path $devEnv)) {
    Write-Host "Copy server\.env.dev.example to server\.env.dev and put the TEST bot token there." -ForegroundColor Red
    exit 1
}
$devToken = Get-EnvValue $devEnv "BOT_TOKEN"
$prodToken = Get-EnvValue (Join-Path $PSScriptRoot "server\.env") "BOT_TOKEN"
if (-not $devToken) { Write-Host "BOT_TOKEN is empty in server\.env.dev." -ForegroundColor Red; exit 1 }
if ($prodToken -and $devToken -eq $prodToken) {
    Write-Host "server\.env.dev has the PRODUCTION token. Use a separate test bot (two pollers would conflict with the VPS)." -ForegroundColor Red
    exit 1
}

$branch = (git rev-parse --abbrev-ref HEAD).Trim()
Write-Host "Frontend from branch: $branch" -ForegroundColor Cyan

$py = Join-Path $PSScriptRoot ".venv\Scripts\python.exe"
if (-not (Test-Path $py)) {
    Write-Host "Creating virtual environment..." -ForegroundColor Cyan
    py -3.12 -m venv .venv
    & $py -m pip install -q --upgrade pip
    & $py -m pip install -q -r server\requirements.txt
}

$port = 8001
$tunnelProc = $null
if ($Tunnel -eq "cloudflare") {
    $cf = (Get-Command cloudflared -ErrorAction SilentlyContinue).Source
    if (-not $cf) { $cf = "${env:ProgramFiles(x86)}\cloudflared\cloudflared.exe" }
    if (-not (Test-Path $cf)) {
        Write-Host "Installing cloudflared..." -ForegroundColor Cyan
        winget install --id Cloudflare.cloudflared -e --accept-source-agreements --accept-package-agreements --silent
        $cf = "${env:ProgramFiles(x86)}\cloudflared\cloudflared.exe"
    }
    $log = Join-Path $PSScriptRoot "tunnel-dev.log"
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
        Write-Host "Tunnel did not start, see tunnel-dev.log" -ForegroundColor Red
        exit 1
    }
    $env:TUNNEL = "none"
    $env:PUBLIC_API_URL = $url
}
else {
    # localhost.run over SSH: the server opens it itself and puts the address into the menu button
    $env:TUNNEL = "ssh"
    $env:PUBLIC_API_URL = ""
    Write-Host "Starting server with localhost.run tunnel..." -ForegroundColor Cyan
}

$env:ENV_FILE = $devEnv
$env:DATA_DIR = Join-Path $PSScriptRoot "server\dev-data"
$env:PORT = "$port"
$env:SERVE_DOCS = "1"
Write-Host "The test bot's menu button will open <tunnel>/app/ (address is in the log)." -ForegroundColor Green
Write-Host "Press Ctrl+C to stop." -ForegroundColor DarkGray
try { & $py -m server }
finally { if ($tunnelProc) { Stop-Process -Id $tunnelProc.Id -Force -ErrorAction SilentlyContinue } }
