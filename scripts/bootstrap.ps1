<#
.SYNOPSIS
  One-shot bootstrap for a fresh Windows kiosk machine.

.DESCRIPTION
  Downloads the latest Bruno Bock repo from GitHub, extracts it, and runs
  install.ps1 - fully unattended when kiosk-config.json is present in the repo.

  Run from an Administrator PowerShell prompt:

    Set-ExecutionPolicy -Scope Process Bypass -Force
    irm https://raw.githubusercontent.com/fuliginheart/bruno-bock-signin/main/scripts/bootstrap.ps1 | iex

  Or from a USB drive:
    Set-ExecutionPolicy -Scope Process Bypass -Force
    & "E:\bootstrap.ps1"

.PARAMETER InstallDir
  Where to install. Default: C:\BrunoBock

.PARAMETER Branch
  GitHub branch to download. Default: main

.PARAMETER KioskIndex
  Which kiosk entry in kiosk-config.json to use (0-based). Omit to auto-detect
  by hostname or be prompted.
#>
[CmdletBinding()]
param(
  [string] $InstallDir  = "C:\BrunoBock",
  [string] $RepoOwner   = "fuliginheart",
  [string] $RepoName    = "bruno-bock-signin",
  [string] $Branch      = "main",
  [int]    $KioskIndex  = -1
)

$ErrorActionPreference = "Stop"
$ProgressPreference    = "SilentlyContinue"

# ---- Require admin ----
$current = [Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()
if (-not $current.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw "bootstrap.ps1 must be run as Administrator. Re-open PowerShell as Admin and retry."
}

Write-Host "==> Bruno Bock Kiosk Bootstrap" -ForegroundColor Cyan
Write-Host "    Repo  : $RepoOwner/$RepoName @ $Branch"
Write-Host "    Target: $InstallDir"
Write-Host ""

# ---- Download repo zip ----
$zipUrl  = "https://github.com/$RepoOwner/$RepoName/archive/refs/heads/$Branch.zip"
$zipPath = Join-Path $env:TEMP "bruno-bock-$Branch.zip"
$extract = Join-Path $env:TEMP "bruno-bock-extract"

Write-Host "==> Downloading repo zip..." -ForegroundColor Cyan
Invoke-WebRequest -Uri $zipUrl -OutFile $zipPath -UseBasicParsing

Write-Host "==> Extracting..." -ForegroundColor Cyan
if (Test-Path $extract) { Remove-Item $extract -Recurse -Force }
Expand-Archive -Path $zipPath -DestinationPath $extract -Force

# GitHub zips extract to <repo>-<branch>/
$repoDir = Get-ChildItem $extract | Select-Object -First 1 -ExpandProperty FullName

# ---- Copy to InstallDir ----
Write-Host "==> Copying to $InstallDir..." -ForegroundColor Cyan
if (-not (Test-Path $InstallDir)) { New-Item -ItemType Directory -Path $InstallDir | Out-Null }
# Use robocopy so files merge correctly into an existing directory.
# Copy-Item -Recurse nests subdirs inside existing dirs instead of merging.
$roboArgs = @(
  $repoDir, $InstallDir,
  "/E",
  "/XD", "node_modules", ".next", ".next-kiosk1", ".next-kiosk2", ".git", "data",
  "/XF", ".env.local",
  "/NP", "/NFL", "/NDL", "/NJH", "/NJS"
)
& robocopy @roboArgs | Out-Null
if ($LASTEXITCODE -ge 8) { throw "robocopy failed with exit code $LASTEXITCODE" }

# ---- Clean up temp files ----
Remove-Item $zipPath -Force -ErrorAction SilentlyContinue
Remove-Item $extract -Recurse -Force -ErrorAction SilentlyContinue

# ---- Run install.ps1 ----
$installScript = Join-Path $InstallDir "scripts\install.ps1"
if (-not (Test-Path $installScript)) { throw "install.ps1 not found at $installScript" }

Write-Host "==> Running install.ps1..." -ForegroundColor Cyan
$installArgs = @("-InstallDir", $InstallDir)
if ($KioskIndex -ge 0) { $installArgs += @("-KioskIndex", $KioskIndex) }

& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $installScript @installArgs

if ($LASTEXITCODE -ne 0) { throw "install.ps1 exited with code $LASTEXITCODE" }
