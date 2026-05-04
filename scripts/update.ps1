<#
.SYNOPSIS
  Download the latest code from GitHub, rebuild, and restart the kiosk service.
  Run this on the kiosk machine after pushing UI or code changes.

.PARAMETER InstallDir
  Where the app lives. Default: C:\BrunoBock

.PARAMETER ServiceName
  NSSM service name. Default: BrunoBockApp

.PARAMETER Repo
  GitHub repo in owner/name format. Default: fuliginheart/bruno-bock-signin

.PARAMETER Branch
  Branch to pull. Default: main

.EXAMPLE
  # From an Admin PowerShell prompt:
  Set-ExecutionPolicy -Scope Process Bypass -Force
  & C:\BrunoBock\scripts\update.ps1
#>
[CmdletBinding()]
param(
  [string] $InstallDir  = "C:\BrunoBock",
  [string] $ServiceName = "BrunoBockApp",
  [string] $Repo        = "fuliginheart/bruno-bock-signin",
  [string] $Branch      = "main"
)

$ErrorActionPreference = "Stop"

function Write-Step($m) { Write-Host "==> $m" -ForegroundColor Cyan }
function Write-Ok($m)   { Write-Host "    OK: $m" -ForegroundColor Green }
function Write-Warn($m) { Write-Host "    WARN: $m" -ForegroundColor Yellow }

# Ensure node/npm are on PATH regardless of how the session was opened.
$env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" +
            [System.Environment]::GetEnvironmentVariable("Path","User") + ";" +
            "C:\Program Files\nodejs;" +
            "C:\ProgramData\nssm\win64;" +
            "$env:APPDATA\npm"

# Locate nssm.
$nssmCmd = Get-Command nssm -ErrorAction SilentlyContinue
if (-not $nssmCmd) {
  $candidates = @(
    "C:\ProgramData\nssm\win64\nssm.exe",
    "C:\Windows\System32\nssm.exe",
    "C:\Program Files\nssm\nssm.exe"
  )
  $found = $candidates | Where-Object { Test-Path $_ } | Select-Object -First 1
  if ($found) { $env:Path += ";$(Split-Path $found)" }
  else { throw "nssm not found. Re-run install.ps1 first, or install NSSM manually." }
}

if (-not (Test-Path $InstallDir)) { throw "Install dir not found: $InstallDir" }

Write-Step "Stopping service '$ServiceName'..."
& nssm stop $ServiceName 2>&1 | Out-Null
Start-Sleep -Seconds 3
# Kill any lingering node processes that might hold file locks.
Stop-Process -Name "node" -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 1
Write-Ok "Service stopped."

# Download latest source as a zip from GitHub (no git required on the machine).
Write-Step "Downloading latest code from GitHub ($Repo @ $Branch)..."
$zipUrl  = "https://github.com/$Repo/archive/refs/heads/$Branch.zip"
$zipPath = Join-Path $env:TEMP "brunobock-update.zip"
$zipDir  = Join-Path $env:TEMP "brunobock-update-extract"
Invoke-WebRequest -Uri $zipUrl -OutFile $zipPath -UseBasicParsing
Write-Ok "Downloaded."

Write-Step "Extracting..."
if (Test-Path $zipDir) { Remove-Item $zipDir -Recurse -Force }
Expand-Archive -Path $zipPath -DestinationPath $zipDir -Force
# GitHub zips extract to a single subdirectory named <repo>-<branch>
$extracted = Get-ChildItem -Path $zipDir -Directory | Select-Object -First 1
if (-not $extracted) { throw "Could not find extracted folder inside zip." }
Write-Ok "Extracted to $($extracted.FullName)"

# Copy everything except node_modules, .next*, and data (preserve DB + env).
# robocopy merges directories correctly; Copy-Item -Recurse nests dirs when dest exists.
Write-Step "Updating files in $InstallDir (preserving data\ and .env.local)..."
$roboArgs = @(
  $extracted.FullName, $InstallDir,
  "/E",                                                         # include subdirs
  "/XD", "node_modules", ".next", ".next-kiosk1", ".next-kiosk2", "data",
  "/XF", ".env.local",                                          # preserve live config
  "/NP", "/NFL", "/NDL", "/NJH", "/NJS"                        # quiet output
)
& robocopy @roboArgs | Out-Null
# robocopy exit codes: 0=no change, 1=copied, 2=extra, 3=both — all fine. 8+ = error.
if ($LASTEXITCODE -ge 8) { throw "robocopy failed with exit code $LASTEXITCODE" }
Remove-Item $zipPath, $zipDir -Recurse -Force -ErrorAction SilentlyContinue
Write-Ok "Files updated."

Push-Location $InstallDir
try {
  # The service runs as LocalSystem, so node_modules may be owned by SYSTEM.
  # Take ownership so the current Admin user can write during npm install.
  if (Test-Path (Join-Path $InstallDir "node_modules")) {
    Write-Step "Taking ownership of node_modules..."
    & takeown /f "$InstallDir\node_modules" /r /d y 2>&1 | Out-Null
    & icacls "$InstallDir\node_modules" /grant "Administrators:F" /t /q 2>&1 | Out-Null
    Write-Ok "Ownership granted."
  }

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
