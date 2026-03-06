# Push .env.local variables to Railway (service: gorgias-webhook).
# Prerequisites: railway login, railway link (from project root).
# Run from project root: .\scripts\railway-push-env.ps1
# Optional: $env:RAILWAY_SERVICE = "my-service"; .\scripts\railway-push-env.ps1

$ErrorActionPreference = "Stop"
$RootDir = Split-Path -Parent $PSScriptRoot
$EnvFile = Join-Path $RootDir ".env.local"
$Service = if ($env:RAILWAY_SERVICE) { $env:RAILWAY_SERVICE } else { "gorgias-webhook" }

if (-not (Test-Path $EnvFile)) {
    Write-Error "Missing .env.local at $EnvFile"
    exit 1
}

railway whoami 2>$null
if ($LASTEXITCODE -ne 0) {
    Write-Error "Not logged in to Railway. Run: railway login"
    exit 1
}

railway status 2>$null
if ($LASTEXITCODE -ne 0) {
    Write-Error "Project not linked. From project root run: railway link"
    exit 1
}

Write-Host "Pushing variables from .env.local to Railway (service: $Service)..."
Get-Content $EnvFile | ForEach-Object {
    $line = ($_ -replace '#.*', '').Trim()
    if ($line -and $line -match '^([^=]+)=(.*)$') {
        $key = $Matches[1].Trim()
        $value = $Matches[2].Trim().Trim('"')
        if ($key) {
            Write-Host "  Setting $key"
            $value | railway variable set $key --stdin -s $Service
        }
    }
}
Write-Host "Done."
Write-Host "Redeploy if needed: railway up"
