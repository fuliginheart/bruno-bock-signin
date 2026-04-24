<#
.SYNOPSIS
  Uninstall the Bruno Bock kiosk.

.DESCRIPTION
  Stops + removes the Windows service, removes the Edge kiosk autostart task,
  removes Edge kiosk policies, and (with confirmation) deletes the install
  directory and its database.
#>
[CmdletBinding()]
param(
  [string] $InstallDir  = "C:\BrunoBock",
  [string] $ServiceName = "BrunoBockApp",
  [switch] $KeepData
)

$ErrorActionPreference = "Stop"
function Write-Step($m) { Write-Host "==> $m" -ForegroundColor Cyan }

$confirm = Read-Host "This will remove the kiosk service, scheduled task, and Edge policies. Continue? (yes/no)"
if ($confirm -ne "yes") { Write-Host "Aborted."; exit 0 }

Write-Step "Removing Windows service '$ServiceName'"
& nssm stop $ServiceName confirm 2>$null | Out-Null
& nssm remove $ServiceName confirm 2>$null | Out-Null

Write-Step "Removing scheduled task"
Unregister-ScheduledTask -TaskName "BrunoBockKioskLaunch" -Confirm:$false -ErrorAction SilentlyContinue | Out-Null
Unregister-ScheduledTask -TaskName "BrunoBockBackup" -Confirm:$false -ErrorAction SilentlyContinue | Out-Null

Write-Step "Removing Edge policies"
$base = "HKLM:\SOFTWARE\Policies\Microsoft\Edge"
if (Test-Path $base) {
  Remove-ItemProperty -Path $base -Name "AutoplayAllowed"   -ErrorAction SilentlyContinue
  Remove-ItemProperty -Path $base -Name "FullscreenAllowed" -ErrorAction SilentlyContinue
  Remove-Item -Path (Join-Path $base "VideoCaptureAllowedUrls") -Recurse -Force -ErrorAction SilentlyContinue
  Remove-Item -Path (Join-Path $base "AudioCaptureAllowedUrls") -Recurse -Force -ErrorAction SilentlyContinue
}

if (-not $KeepData) {
  $confirm2 = Read-Host "Delete install dir AND database at $InstallDir ? (type 'DELETE' to confirm)"
  if ($confirm2 -eq "DELETE") {
    Write-Step "Removing $InstallDir"
    Remove-Item -Path $InstallDir -Recurse -Force -ErrorAction SilentlyContinue
  } else {
    Write-Host "Install dir preserved."
  }
} else {
  Write-Host "Install dir preserved (-KeepData)."
}

Write-Host "Uninstall complete." -ForegroundColor Green
