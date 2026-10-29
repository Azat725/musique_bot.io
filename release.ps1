# Musique release: merge dev -> main, push, update the VPS. Asks before every step.
# Usage: powershell -File release.ps1      (VPS_HOST comes from server\.env.dev)
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

function Confirm-Step($text) {
    $a = Read-Host "$text [y/N]"
    if ($a -notin @("y", "Y", [string][char]0x0434, [string][char]0x0414)) { Write-Host "Stopped." -ForegroundColor Yellow; exit 1 }
}
function Run($cmd) { Write-Host "> $cmd" -ForegroundColor DarkGray; Invoke-Expression $cmd; if ($LASTEXITCODE) { throw "failed: $cmd" } }

if (git status --porcelain --untracked-files=no) { Write-Host "There are uncommitted changes - commit them to dev first." -ForegroundColor Red; exit 1 }
$line = Get-Content "server\.env.dev" -ErrorAction SilentlyContinue | Where-Object { $_ -match "^\s*VPS_HOST\s*=" } | Select-Object -First 1
$vps = if ($line) { ($line -replace "^\s*VPS_HOST\s*=\s*", "").Trim() }
if (-not $vps) { Write-Host "Set VPS_HOST in server\.env.dev." -ForegroundColor Red; exit 1 }

Run "git fetch origin"
Write-Host "`nWill go to production:" -ForegroundColor Cyan
Run "git log --oneline origin/main..dev"
Confirm-Step "Did you test this in the test bot (dev.ps1)? Merge dev into main?"

Run "git checkout main"
try {
    Run "git pull --ff-only origin main"
    Run "git merge --no-ff dev -m 'Release: merge dev into main'"
    Confirm-Step "Push main to GitHub (GitHub Pages updates in 1-2 min)?"
    Run "git push origin main"
}
finally { git checkout dev | Out-Null }

Confirm-Step "Update the server $vps (rebuilds the container, ~1 min of downtime)?"
Run "ssh root@$vps 'cd ~/musique && git pull && docker compose --env-file server/.env up -d --build'"
Write-Host "`nDone. Open @musiqueenbot and check; if broken: git revert -m 1 <merge commit> on main, push, repeat the server update." -ForegroundColor Green
