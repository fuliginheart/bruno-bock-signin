<#
.SYNOPSIS
  Pull the latest code from GitHub, rebuild, and restart the kiosk service.
  Run this on the kiosk machine after pushing UI or code changes.

.PARAMETER InstallDir
  Where the app lives. Default: C:\BrunoBock

.PARAMETER ServiceName
  NSSM service name. Default: BrunoBockApp

.EXAMPLE
  # From an Admin PowerShell prompt:
  Set-ExecutionPolicy -Scope Process Bypass -Force
  & C:\BrunoBock\scripts\update.ps1
#>
[CmdletBinding()]
param(
  [string] $InstallDir  = "C:\BrunoBock",
  [string] $ServiceName = "BrunoBockApp"
)

$ErrorActionPreference = "Stop"

function Write-Step($m) { Write-Host "==> $m" -ForegroundColor Cyan }
function Write-Ok($m)   { Write-Host "    OK: $m" -ForegroundColor Green }
function Write-Warn($m) { Write-Host "    WARN: $m" -ForegroundColor Yellow }

if (-not (Test-Path $InstallDir)) { throw "Install dir not found: $InstallDir" }

Write-Step "Stopping service '$ServiceName'..."
& nssm stop $ServiceName 2>&1 | Out-Null
Start-Sleep -Seconds 2
Write-Ok "Service stopped."

Push-Location $InstallDir
try {
  Write-Step "Pulling latest code..."
  & git pull --ff-only
  if ($LASTEXITCODE -ne 0) { throw "git pull failed." }
  Write-Ok "git pull complete."

  Write-Step "Installing/updating npm dependencies..."
  & npm install --prefer-offline --no-fund --no-audit
  if ($LASTEXITCODE -ne 0) { throw "npm install failed." }
  Write-Ok "Dependencies up to date."

  Write-Step "Building app..."
  & npm run build
  if ($LASTEXITCODE -ne 0) { throw "npm run build failed." }
  Write-Ok "Build complete."
} finally {
  Pop-Location
}

Write-Step "Starting service '$ServiceName'..."
& nssm start $ServiceName 2>&1 | Out-Null
Start-Sleep -Seconds 3

$status = & nssm status $ServiceName 2>&1
Write-Host "    Service status: $status"
if ($status -match "RUNNING") {
  Write-Ok "Service is running."
} else {
  Write-Warn "Service may not have started. Check with: nssm status $ServiceName"
}

Write-Host ""
Write-Host "==========================================" -ForegroundColor Magenta
Write-Host " Bruno Bock update complete"               -ForegroundColor Magenta
Write-Host "==========================================" -ForegroundColor Magenta
Write-Host ""
