<#
.SYNOPSIS
  Manually launch the kiosk browser. Use for debugging or if the autostart
  Scheduled Task is disabled. Edge must already be installed.
#>
param(
  [int] $Port = 3000
)

$url = "http://localhost:$Port"
$edge = "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe"
if (-not (Test-Path $edge)) {
  $edge = "${env:ProgramFiles}\Microsoft\Edge\Application\msedge.exe"
}
if (-not (Test-Path $edge)) { throw "Edge not found." }

& $edge --kiosk $url --edge-kiosk-type=fullscreen --no-first-run --start-fullscreen
