<#
.SYNOPSIS
  Update an existing Bruno Bock kiosk installation.

.DESCRIPTION
  Pulls the latest code (or unpacks a release zip), reinstalls deps, runs
  migrations, and restarts the Windows service.
#>
[CmdletBinding()]
param(
  [string] $InstallDir  = "C:\BrunoBock",
  [string] $ServiceName = "BrunoBockApp",
  [string] $ReleaseZip
)

$ErrorActionPreference = "Stop"

function Write-Step($m) { Write-Host "==> $m" -ForegroundColor Cyan }

if (-not (Test-Path $InstallDir)) { throw "Install dir not found: $InstallDir" }

Write-Step "Stopping service $ServiceName"
& nssm stop $ServiceName confirm | Out-Null

Push-Location $InstallDir
try {
  if ($ReleaseZip) {
    Write-Step "Unpacking $ReleaseZip"
    Expand-Archive -Path $ReleaseZip -DestinationPath $InstallDir -Force
  } elseif (Test-Path (Join-Path $InstallDir ".git")) {
    Write-Step "git pull"
    & git pull --ff-only
    if ($LASTEXITCODE -ne 0) { throw "git pull failed." }
  } else {
    Write-Host "No .git and no -ReleaseZip; skipping source update."
  }

  Write-Step "npm ci"
  & npm ci --no-audit --no-fund
  if ($LASTEXITCODE -ne 0) { throw "npm ci failed." }

  Write-Step "Build"
  & npm run build
  if ($LASTEXITCODE -ne 0) { throw "build failed." }

  Write-Step "Migrate"
  & npm run db:migrate
  if ($LASTEXITCODE -ne 0) { throw "migrate failed." }
} finally {
  Pop-Location
}

Write-Step "Starting service $ServiceName"
& nssm start $ServiceName | Out-Null
Write-Host "Update complete." -ForegroundColor Green
