<#
.SYNOPSIS
  Bruno Bock Sign-In Kiosk — automated installer.

.DESCRIPTION
  One-shot installer for a fresh Windows 10/11 machine. Run as Administrator.

  If kiosk-config.json exists in the repo root (or InstallDir), the installer
  reads all settings from it and runs fully unattended. Otherwise it falls back
  to interactive prompts.

  Steps:
    1. Install prerequisites via winget (Node LTS, Git, NSSM).
    2. Stage the application into the install directory.
    3. npm ci & build.
    4. Read kiosk-config.json (or prompt) for identity/PIN/peers.
    5. Hash the PIN and write .env.local.
    6. Run database migrations.
    7. Install and start the Windows service via NSSM.
    8. Apply Edge kiosk policies (camera auto-allow, autoplay, fullscreen).
    9. Create a Task Scheduler task to launch Edge in --kiosk mode at logon.
   10. Disable sleep / screensaver / display timeout.
   11. Configure Windows auto-login (from config or -EnableAutoLogin flag).

.PARAMETER InstallDir
  Where to place the application files. Default: C:\BrunoBock

.PARAMETER ServiceName
  NSSM service name. Default: BrunoBockApp

.PARAMETER SkipPrereqs
  Skip the winget step (use if Node/Git/NSSM are already present).

.PARAMETER KioskIndex
  Which entry in kiosk-config.json kiosks[] to use (0-based). If omitted,
  the installer matches by machine hostname, then prompts if ambiguous.

.PARAMETER EnableAutoLogin
  Force auto-login setup even if autoLogin is false in kiosk-config.json.

.EXAMPLE
  # Fully unattended (kiosk-config.json present):
  Set-ExecutionPolicy -Scope Process Bypass
  .\scripts\install.ps1

  # Specific kiosk from config:
  .\scripts\install.ps1 -KioskIndex 1
#>
[CmdletBinding()]
param(
  [string] $InstallDir   = "C:\BrunoBock",
  [string] $ServiceName  = "BrunoBockApp",
  [switch] $SkipPrereqs,
  [int]    $KioskIndex   = -1,
  [switch] $EnableAutoLogin
)

$ErrorActionPreference = "Stop"
$ProgressPreference    = "SilentlyContinue"

function Write-Step($msg) { Write-Host "==> $msg" -ForegroundColor Cyan }
function Write-Ok($msg)   { Write-Host "    OK: $msg" -ForegroundColor Green }
function Write-Warn2($msg){ Write-Host "    !! $msg" -ForegroundColor Yellow }

function Assert-Admin {
  $current = [Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()
  if (-not $current.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw "install.ps1 must be run as Administrator."
  }
}

function Test-Cmd($name) {
  return [bool] (Get-Command $name -ErrorAction SilentlyContinue)
}

function Install-Prereqs {
  Write-Step "Installing prerequisites via winget"
  if (-not (Test-Cmd "winget")) {
    throw "winget is not available. Install App Installer from the Microsoft Store, then re-run."
  }

  $packages = @(
    @{ Id = "OpenJS.NodeJS.LTS"; Cmd = "node" },
    @{ Id = "Git.Git";           Cmd = "git"  },
    @{ Id = "NSSM.NSSM";         Cmd = "nssm" }
  )

  foreach ($p in $packages) {
    if (Test-Cmd $p.Cmd) {
      Write-Ok "$($p.Id) already installed."
      continue
    }
    Write-Host "    Installing $($p.Id) ..."
    & winget install --id $p.Id -e --silent --accept-source-agreements --accept-package-agreements | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "winget install $($p.Id) failed (exit $LASTEXITCODE)." }
  }

  # Refresh PATH so newly installed tools are visible to this session.
  $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" +
              [System.Environment]::GetEnvironmentVariable("Path","User")
}

function Stage-App {
  Write-Step "Staging application into $InstallDir"
  $repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
  if (-not (Test-Path $InstallDir)) {
    New-Item -ItemType Directory -Path $InstallDir | Out-Null
  }

  $sameLocation = (Resolve-Path $repoRoot).Path -ieq (Resolve-Path $InstallDir).Path
  if ($sameLocation) {
    Write-Ok "Repository already lives at install dir; skipping copy."
    return
  }

  $excludes = @("node_modules", ".next", ".git", "data")
  Get-ChildItem -Path $repoRoot -Force | Where-Object { $excludes -notcontains $_.Name } | ForEach-Object {
    Copy-Item -Path $_.FullName -Destination $InstallDir -Recurse -Force
  }
  Write-Ok "Staged."
}

function Install-Deps {
  Write-Step "Installing npm dependencies (npm ci)"
  Push-Location $InstallDir
  try {
    & npm ci --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) { throw "npm ci failed." }
    Write-Step "Building Next.js"
    & npm run build
    if ($LASTEXITCODE -ne 0) { throw "npm run build failed." }
  } finally {
    Pop-Location
  }
}

function Read-SecurePin($prompt) {
  $sec = Read-Host -Prompt $prompt -AsSecureString
  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec)
  try { return [Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
}

function Load-KioskConfig {
  # Look for kiosk-config.json next to the script (repo root) or in InstallDir.
  $candidates = @(
    (Join-Path (Split-Path $PSScriptRoot -Parent) "kiosk-config.json"),
    (Join-Path $InstallDir "kiosk-config.json")
  )
  foreach ($path in $candidates) {
    if (Test-Path $path) {
      Write-Ok "Found kiosk-config.json at $path"
      return (Get-Content $path -Raw | ConvertFrom-Json)
    }
  }
  return $null
}

function Select-Kiosk($config) {
  $kiosks = $config.kiosks
  if (-not $kiosks -or $kiosks.Count -eq 0) { return $null }

  # Explicit index wins.
  if ($KioskIndex -ge 0) {
    if ($KioskIndex -ge $kiosks.Count) { throw "-KioskIndex $KioskIndex is out of range ($($kiosks.Count) kiosks defined)." }
    Write-Ok "Using kiosk index ${KioskIndex}: $($kiosks[$KioskIndex].name)"
    return $kiosks[$KioskIndex]
  }

  # Auto-match by hostname.
  $hostname = $env:COMPUTERNAME
  $matched = $kiosks | Where-Object { $_.matchHostname -and ($_.matchHostname -ieq $hostname) }
  if ($matched -and @($matched).Count -eq 1) {
    Write-Ok "Auto-matched kiosk by hostname '$hostname': $($matched.name)"
    return $matched
  }

  # Only one kiosk defined — use it without asking.
  if ($kiosks.Count -eq 1) {
    Write-Ok "Single kiosk defined; using: $($kiosks[0].name)"
    return $kiosks[0]
  }

  # Prompt the user to pick.
  Write-Host "`nMultiple kiosks defined. Which is this machine?" -ForegroundColor Yellow
  for ($i = 0; $i -lt $kiosks.Count; $i++) {
    Write-Host "  [$i] $($kiosks[$i].name) (id=$($kiosks[$i].id), port=$($kiosks[$i].port))"
  }
  $choice = Read-Host "Enter number"
  return $kiosks[[int]$choice]
}

function Get-Config {
  Write-Step "Collecting configuration"

  $config = Load-KioskConfig

  if ($config) {
    $kiosk = Select-Kiosk $config
    if (-not $kiosk) { throw "kiosk-config.json has no 'kiosks' array or it is empty." }

    if (-not $config.adminPinHash) {
      throw "kiosk-config.json is missing 'adminPinHash'. Run: npx tsx scripts/hash-pin.ts and paste the output."
    }

    return @{
      KioskId     = $kiosk.id
      KioskName   = $kiosk.name
      Peers       = if ($kiosk.peers)  { $kiosk.peers  } else { "" }
      PinHash     = $config.adminPinHash   # already hashed — skip hash-pin step
      DbPath      = Join-Path $InstallDir "data\db.sqlite"
      MediaPath   = Join-Path $InstallDir "data\media"
      Port        = if ($kiosk.port)   { [string]$kiosk.port } else { "3000" }
      AutoLogin   = [bool]$config.autoLogin
      LoginUser   = if ($config.autoLoginUser)     { $config.autoLoginUser }     else { "KioskUser" }
      LoginPass   = if ($config.autoLoginPassword) { $config.autoLoginPassword } else { "" }
    }
  }

  # --- Fallback: interactive prompts ---
  Write-Warn2 "No kiosk-config.json found. Falling back to interactive prompts."
  Write-Warn2 "Create kiosk-config.json from kiosk-config.example.json to skip this next time."
  Write-Host ""

  $kioskId   = Read-Host "Kiosk ID (short, unique, e.g. K1, lobby, dock-east)"
  if (-not $kioskId) { throw "Kiosk ID is required." }
  $kioskName = Read-Host "Friendly kiosk name (e.g. 'Lobby Kiosk')"
  if (-not $kioskName) { $kioskName = $kioskId }
  $peers     = Read-Host "Peer kiosk URLs, comma-separated (blank if this is the first kiosk)"
  $port      = Read-Host "HTTP port [3000]"
  if (-not $port) { $port = "3000" }

  $pin = $null
  while ($true) {
    $pin1 = Read-SecurePin "Admin PIN (4-12 digits)"
    if ($pin1.Length -lt 4) { Write-Warn2 "PIN too short."; continue }
    $pin2 = Read-SecurePin "Confirm admin PIN"
    if ($pin1 -ne $pin2) { Write-Warn2 "PINs do not match."; continue }
    $pin = $pin1
    break
  }

  return @{
    KioskId   = $kioskId; KioskName = $kioskName; Peers = $peers
    AdminPin  = $pin; PinHash = $null
    DbPath    = Join-Path $InstallDir "data\db.sqlite"
    MediaPath = Join-Path $InstallDir "data\media"
    Port      = $port
    AutoLogin = $EnableAutoLogin.IsPresent
    LoginUser = "KioskUser"; LoginPass = ""
  }
}

function Hash-Pin($cfg) {
  # If kiosk-config.json already provided a hash, skip this step.
  if ($cfg.PinHash) {
    Write-Ok "Using pre-hashed admin PIN from kiosk-config.json."
    return $cfg.PinHash
  }
  Write-Step "Hashing admin PIN"
  Push-Location $InstallDir
  try {
    $hash = $cfg.AdminPin | & npx --yes tsx scripts/hash-pin.ts
    if ($LASTEXITCODE -ne 0 -or -not $hash) { throw "hash-pin failed." }
    return $hash.Trim()
  } finally { Pop-Location }
}

function Write-EnvFile($cfg, $pinHash) {
  Write-Step "Writing .env.local"
  $envFile = Join-Path $InstallDir ".env.local"
  $lines = @(
    "KIOSK_ID=$($cfg.KioskId)",
    "KIOSK_NAME=$($cfg.KioskName)",
    "LEADER_DISCOVERY=$($cfg.Peers)",
    "ADMIN_PIN_HASH=$pinHash",
    "DB_PATH=$($cfg.DbPath)",
    "MEDIA_PATH=$($cfg.MediaPath)",
    "PORT=$($cfg.Port)",
    "HOSTNAME=0.0.0.0",
    "LOG_LEVEL=info",
    "LOG_DIR=$(Join-Path $InstallDir 'data\logs')"
  )
  Set-Content -Path $envFile -Value $lines -Encoding ASCII
  Write-Ok "Wrote $envFile"

  # Ensure data dirs exist.
  $dbDir = Split-Path -Parent $cfg.DbPath
  if (-not (Test-Path $dbDir)) { New-Item -ItemType Directory -Force -Path $dbDir | Out-Null }
  if (-not (Test-Path $cfg.MediaPath)) { New-Item -ItemType Directory -Force -Path $cfg.MediaPath | Out-Null }
}

function Run-Migrations {
  Write-Step "Running database migrations"
  Push-Location $InstallDir
  try {
    & npm run db:migrate
    if ($LASTEXITCODE -ne 0) { throw "db:migrate failed." }
  } finally { Pop-Location }
}

function Install-Service {
  Write-Step "Installing Windows service '$ServiceName' via NSSM"
  if (-not (Test-Cmd "nssm")) { throw "nssm is required but not on PATH." }

  # If the service already exists, stop & remove it for a clean install.
  $existing = & sc.exe query $ServiceName 2>$null
  if ($LASTEXITCODE -eq 0) {
    Write-Host "    Existing service found; removing."
    & nssm stop $ServiceName confirm | Out-Null
    & nssm remove $ServiceName confirm | Out-Null
  }

  $node = (Get-Command node).Source
  & nssm install $ServiceName $node "$InstallDir\node_modules\next\dist\bin\next" "start"
  & nssm set $ServiceName AppDirectory $InstallDir
  & nssm set $ServiceName AppStdout    "$InstallDir\data\service.out.log"
  & nssm set $ServiceName AppStderr    "$InstallDir\data\service.err.log"
  & nssm set $ServiceName AppRotateFiles 1
  & nssm set $ServiceName AppRotateBytes 5242880
  & nssm set $ServiceName Start SERVICE_AUTO_START
  & nssm set $ServiceName AppExit Default Restart
  & nssm set $ServiceName AppRestartDelay 5000

  # Use our custom server.ts via tsx instead of `next start` (we have a custom server).
  $tsx = "$InstallDir\node_modules\tsx\dist\cli.mjs"
  & nssm set $ServiceName Application $node
  & nssm set $ServiceName AppParameters "`"$tsx`" --env-file=`"$InstallDir\.env.local`" `"$InstallDir\server.ts`""
  & nssm set $ServiceName AppEnvironmentExtra "NODE_ENV=production"

  & nssm start $ServiceName | Out-Null
  Write-Ok "Service '$ServiceName' installed and started."
}

function Apply-EdgePolicies {
  Write-Step "Applying Edge kiosk policies"
  $base = "HKLM:\SOFTWARE\Policies\Microsoft\Edge"
  if (-not (Test-Path $base)) { New-Item -Path $base -Force | Out-Null }

  Set-ItemProperty -Path $base -Name "AutoplayAllowed"   -Type DWord -Value 1
  Set-ItemProperty -Path $base -Name "FullscreenAllowed" -Type DWord -Value 1

  # Camera + microphone auto-allow for our origin.
  $allowKey = Join-Path $base "VideoCaptureAllowedUrls"
  if (-not (Test-Path $allowKey)) { New-Item -Path $allowKey -Force | Out-Null }
  Set-ItemProperty -Path $allowKey -Name "1" -Value "http://localhost:*"

  $audioKey = Join-Path $base "AudioCaptureAllowedUrls"
  if (-not (Test-Path $audioKey)) { New-Item -Path $audioKey -Force | Out-Null }
  Set-ItemProperty -Path $audioKey -Name "1" -Value "http://localhost:*"

  Write-Ok "Edge policies set."
}

function Register-KioskAutostart($port) {
  Write-Step "Registering Edge --kiosk launch at logon"
  $taskName = "BrunoBockKioskLaunch"
  $url = "http://localhost:$port"
  $edge = "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe"
  if (-not (Test-Path $edge)) {
    $edge = "${env:ProgramFiles}\Microsoft\Edge\Application\msedge.exe"
  }
  if (-not (Test-Path $edge)) { Write-Warn2 "Edge not found; skipping autostart task."; return }

  $action  = New-ScheduledTaskAction -Execute $edge `
              -Argument "--kiosk $url --edge-kiosk-type=fullscreen --no-first-run --start-fullscreen"
  $trigger = New-ScheduledTaskTrigger -AtLogOn
  $trigger.Delay = "PT5S"
  $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
              -StartWhenAvailable

  Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue | Out-Null
  Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings `
    -Description "Launch Bruno Bock kiosk in Edge fullscreen at logon." | Out-Null
  Write-Ok "Scheduled task '$taskName' created."
}

function Disable-Sleep {
  Write-Step "Disabling sleep, screensaver, display timeout"
  & powercfg /change standby-timeout-ac 0
  & powercfg /change standby-timeout-dc 0
  & powercfg /change monitor-timeout-ac 0
  & powercfg /change monitor-timeout-dc 0
  & powercfg /change disk-timeout-ac 0
  & powercfg /change disk-timeout-dc 0
  & powercfg /change hibernate-timeout-ac 0
  & powercfg /change hibernate-timeout-dc 0
  Write-Ok "Power policy updated."
}

function Register-BackupTask($cfg) {
  Write-Step "Registering nightly DB backup task"
  $taskName = "BrunoBockBackup"
  $script   = Join-Path $InstallDir "scripts\backup.ps1"
  if (-not (Test-Path $script)) { Write-Warn2 "backup.ps1 not found; skipping."; return }

  $action = New-ScheduledTaskAction -Execute "powershell.exe" `
            -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$script`" -InstallDir `"$InstallDir`" -DbPath `"$($cfg.DbPath)`""
  $trigger = New-ScheduledTaskTrigger -Daily -At 2am
  $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
              -StartWhenAvailable
  $principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest

  Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue | Out-Null
  Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger `
    -Settings $settings -Principal $principal `
    -Description "Nightly SQLite backup of the Bruno Bock kiosk DB." | Out-Null
  Write-Ok "Scheduled task '$taskName' created."
}

function Configure-AutoLogin($cfg) {
  $doIt = $cfg.AutoLogin -or $EnableAutoLogin
  if (-not $doIt) { return }
  Write-Step "Configuring auto-login"

  $user = $cfg.LoginUser
  $pass = $cfg.LoginPass

  # If password not in config, prompt (only happens in interactive fallback).
  if (-not $pass) {
    $pass = Read-SecurePin "Password for auto-login user '$user'"
  }

  if (-not (Get-LocalUser -Name $user -ErrorAction SilentlyContinue)) {
    $sec = ConvertTo-SecureString $pass -AsPlainText -Force
    New-LocalUser -Name $user -Password $sec -PasswordNeverExpires -UserMayNotChangePassword | Out-Null
    Add-LocalGroupMember -Group "Users" -Member $user -ErrorAction SilentlyContinue
  }
  $base = "HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon"
  Set-ItemProperty -Path $base -Name "AutoAdminLogon" -Value "1"
  Set-ItemProperty -Path $base -Name "DefaultUserName" -Value $user
  Set-ItemProperty -Path $base -Name "DefaultPassword" -Value $pass
  Write-Ok "Auto-login enabled for '$user'."
}

function Print-Summary($cfg) {
  Write-Host ""
  Write-Host "==========================================" -ForegroundColor Magenta
  Write-Host " Bruno Bock kiosk install complete"        -ForegroundColor Magenta
  Write-Host "==========================================" -ForegroundColor Magenta
  Write-Host "  Kiosk ID    : $($cfg.KioskId)"
  Write-Host "  Kiosk name  : $($cfg.KioskName)"
  Write-Host "  Install dir : $InstallDir"
  Write-Host "  Service     : $ServiceName"
  Write-Host "  Health URL  : http://localhost:$($cfg.Port)/api/health"
  Write-Host "  Peers       : $($cfg.Peers)"
  Write-Host ""
  Write-Host " To exit kiosk Edge: Ctrl+Shift+W or Alt+F4."
  Write-Host " To open admin: long-press the top-right corner for 3 seconds."
  Write-Host ""
}

# --- Main ---
Assert-Admin
if (-not $SkipPrereqs) { Install-Prereqs }
Stage-App
Install-Deps
$cfg     = Get-Config
$pinHash = Hash-Pin $cfg
Write-EnvFile $cfg $pinHash
Run-Migrations
Install-Service
Apply-EdgePolicies
Register-KioskAutostart $cfg.Port
Disable-Sleep
Register-BackupTask $cfg
Configure-AutoLogin $cfg
Print-Summary $cfg
