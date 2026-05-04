<#
.SYNOPSIS
  Bruno Bock Sign-In Kiosk - automated installer.

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
  # Map HKU: PSDrive so we can Test-Path "HKU:\<SID>" later.
  if (-not (Get-PSDrive -Name HKU -ErrorAction SilentlyContinue)) {
    New-PSDrive -Name HKU -PSProvider Registry -Root HKEY_USERS | Out-Null
  }
}

function Test-Cmd($name) {
  return [bool] (Get-Command $name -ErrorAction SilentlyContinue)
}

function Refresh-Path {
  $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" +
              [System.Environment]::GetEnvironmentVariable("Path","User") + ";" +
              "C:\Program Files\nodejs;" +
              "C:\Program Files\Git\cmd;" +
              "C:\Program Files\Git\bin;" +
              "C:\ProgramData\nssm\win64;" +
              "$env:APPDATA\npm"
}

function Install-Nssm {
  # Try winget first (may fail on some machines - that's OK).
  if (Test-Cmd "winget") {
    Write-Host "    Trying winget for NSSM..."
    & winget install --id NSSM.NSSM -e --silent --accept-source-agreements --accept-package-agreements 2>&1 | Out-Null
    Refresh-Path
    if (Test-Cmd "nssm") { Write-Ok "NSSM installed via winget."; return }
  }

  # Direct download from nssm.cc (always works, no Store/winget dependency).
  Write-Host "    Downloading NSSM from nssm.cc..."
  $zipPath = Join-Path $env:TEMP "nssm-2.24.zip"
  $zipDir  = Join-Path $env:TEMP "nssm-extract"
  Invoke-WebRequest -Uri "https://nssm.cc/release/nssm-2.24.zip" -OutFile $zipPath -UseBasicParsing
  if (Test-Path $zipDir) { Remove-Item $zipDir -Recurse -Force }
  Expand-Archive -Path $zipPath -DestinationPath $zipDir -Force

  # The zip extracts to nssm-2.24\win64\nssm.exe (or win32 on 32-bit)
  $arch    = if ([Environment]::Is64BitOperatingSystem) { "win64" } else { "win32" }
  $nssmExe = Get-ChildItem -Path $zipDir -Filter "nssm.exe" -Recurse |
             Where-Object { $_.FullName -match $arch } |
             Select-Object -First 1
  if (-not $nssmExe) {
    $nssmExe = Get-ChildItem -Path $zipDir -Filter "nssm.exe" -Recurse | Select-Object -First 1
  }
  if (-not $nssmExe) { throw "Could not find nssm.exe inside downloaded zip." }

  $dest = "$env:SystemRoot\System32\nssm.exe"
  Copy-Item $nssmExe.FullName -Destination $dest -Force
  Remove-Item $zipPath, $zipDir -Recurse -Force -ErrorAction SilentlyContinue
  Write-Ok "NSSM installed to $dest"
}

function Install-Prereqs {
  Write-Step "Installing prerequisites"

  # --- Node.js ---
  if (Test-Cmd "node") {
    Write-Ok "Node.js already installed."
  } else {
    Write-Host "    Installing Node.js LTS..."
    if (Test-Cmd "winget") {
      & winget install --id OpenJS.NodeJS.LTS -e --silent --accept-source-agreements --accept-package-agreements 2>&1 | Out-Null
    }
    Refresh-Path
    if (-not (Test-Cmd "node")) {
      throw "Node.js not found after install. Install manually from https://nodejs.org then re-run with -SkipPrereqs."
    }
    Write-Ok "Node.js installed."
  }

  # --- Git ---
  if (Test-Cmd "git") {
    Write-Ok "Git already installed."
  } else {
    Write-Host "    Installing Git..."
    if (Test-Cmd "winget") {
      & winget install --id Git.Git -e --silent --accept-source-agreements --accept-package-agreements 2>&1 | Out-Null
    }
    Refresh-Path
    if (-not (Test-Cmd "git")) {
      throw "Git not found after install. Install manually from https://git-scm.com then re-run with -SkipPrereqs."
    }
    Write-Ok "Git installed."
  }

  # --- NSSM ---
  if (Test-Cmd "nssm") {
    Write-Ok "NSSM already installed."
  } else {
    Install-Nssm
    Refresh-Path
    if (-not (Test-Cmd "nssm")) { throw "NSSM not found after install. Please install NSSM manually and re-run." }
  }

  Refresh-Path
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

  # Grant Users group full inherited control so BBKioskUser and SYSTEM-owned files
  # are always writable by non-admin sessions (needed for update without elevation).
  & icacls $InstallDir /grant "BUILTIN\Users:(OI)(CI)F" /T /Q 2>&1 | Out-Null

  Write-Ok "Staged."
}

function Install-Deps {
  Write-Step "Installing npm dependencies (npm ci)"

  # On reinstall, node_modules may be owned by SYSTEM (left by the old service).
  # Take ownership and nuke it so npm ci gets a clean slate.
  $nm = Join-Path $InstallDir "node_modules"
  if (Test-Path $nm) {
    Write-Host "    Clearing old node_modules (may be SYSTEM-owned)..."
    & takeown /f $nm /r /d y 2>&1 | Out-Null
    & icacls $nm /grant "Administrators:F" /t /q 2>&1 | Out-Null
    Remove-Item $nm -Recurse -Force -ErrorAction SilentlyContinue
    Write-Ok "node_modules removed."
  }

  # The npm cache may also be SYSTEM-owned (service ran npm during build).
  # Point to a fresh local cache to avoid EPERM errors.
  $npmCache = Join-Path $InstallDir ".npm-cache"
  if (Test-Path $npmCache) {
    & takeown /f $npmCache /r /d y 2>&1 | Out-Null
    & icacls $npmCache /grant "Administrators:F" /t /q 2>&1 | Out-Null
    Remove-Item $npmCache -Recurse -Force -ErrorAction SilentlyContinue
  }

  Push-Location $InstallDir
  try {
    & npm ci --no-audit --no-fund --cache $npmCache
    if ($LASTEXITCODE -ne 0) { throw "npm ci failed." }
  } finally {
    Pop-Location
  }
}

function Build-App {
  Write-Step "Building Next.js (requires .env.local)"
  Push-Location $InstallDir
  try {
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

  # Only one kiosk defined - use it without asking.
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
      KioskId       = $kiosk.id
      KioskName     = $kiosk.name
      Peers         = if ($kiosk.peers)         { $kiosk.peers         } else { "" }
      MatchHostname = if ($kiosk.matchHostname) { $kiosk.matchHostname } else { "" }
      PinHash       = $config.adminPinHash   # already hashed - skip hash-pin step
      DbPath        = Join-Path $InstallDir "data\db.sqlite"
      MediaPath     = Join-Path $InstallDir "data\media"
      Port          = if ($kiosk.port) { [string]$kiosk.port } else { "3000" }
      AutoLogin     = [bool]$config.autoLogin
      LoginUser     = if ($config.autoLoginUser)     { $config.autoLoginUser }     else { "KioskUser" }
      LoginPass     = if ($config.autoLoginPassword) { $config.autoLoginPassword } else { "" }
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

function Write-KioskShellScript($port, $kioskUser) {
  Write-Step "Writing kiosk shell launcher (kiosk-shell.cmd)"
  $shellPath = Join-Path $InstallDir "kiosk-shell.cmd"
  $url = "http://localhost:$port"

  # Uses %ProgramFiles% so the .cmd file works regardless of where Edge is installed.
  # Non-kiosk users (e.g. Admin) fall through to explorer.exe normally.
  $lines = @(
    "@echo off",
    ":: Bruno Bock Kiosk Shell",
    ":: Non-kiosk users: launch explorer detached so it self-inits the shell,",
    ":: then keep this cmd.exe alive so Windows sees the shell process running.",
    "if /i ""%USERNAME%"" neq ""$kioskUser"" (",
    "  start explorer.exe",
    "  :idleloop",
    "  timeout /t 60 /nobreak >nul",
    "  goto idleloop",
    ")",
    "",
    ":waitloop",
    "curl.exe -s $url/api/health >nul 2>&1",
    "if errorlevel 1 ( timeout /t 3 /nobreak >nul & goto waitloop )",
    "",
    ":loop",
    "if exist ""%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"" (",
    "  start /wait """" ""%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"" --kiosk $url --edge-kiosk-type=fullscreen --no-first-run --start-fullscreen --disable-features=Translate",
    ") else (",
    "  start /wait """" ""%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"" --kiosk $url --edge-kiosk-type=fullscreen --no-first-run --start-fullscreen --disable-features=Translate",
    ")",
    "timeout /t 3 /nobreak >nul",
    "goto loop"
  )
  Set-Content -Path $shellPath -Value $lines -Encoding ASCII
  Write-Ok "Wrote $shellPath"
  return $shellPath
}

function Configure-KioskShell($user, $pass, $shellPath) {
  Write-Step "Configuring kiosk shell for user '$user'"

  # Step 1: Restore HKLM Shell to explorer.exe so Admin and all non-kiosk users
  # get a normal Windows desktop (userinit -> explorer.exe -> taskbar/desktop).
  # The kiosk user gets their own HKCU Shell override set below.
  $winlogon = "HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon"
  Set-ItemProperty -Path $winlogon -Name "Shell" -Value "explorer.exe"
  Write-Ok "HKLM Shell = explorer.exe (Admin users get normal desktop)"

  # Step 2: Ensure the kiosk user's Windows profile (NTUSER.DAT) exists.
  $profileDir = "$env:SystemDrive\Users\$user"
  $ntuserDat  = Join-Path $profileDir "NTUSER.DAT"
  if (-not (Test-Path $ntuserDat)) {
    Write-Host "    Creating user profile for '$user'..."
    try {
      $sec  = ConvertTo-SecureString $pass -AsPlainText -Force
      $cred = New-Object System.Management.Automation.PSCredential("$env:COMPUTERNAME\$user", $sec)
      Start-Process -FilePath "cmd.exe" -ArgumentList "/c exit" `
        -Credential $cred -LoadUserProfile -Wait -WindowStyle Hidden -ErrorAction Stop
      Start-Sleep -Seconds 2   # let Windows finish unloading the profile hive
      Write-Ok "User profile created."
    } catch {
      Write-Warn2 "Profile auto-create failed ($_) -- copying Default profile as fallback..."
      New-Item -ItemType Directory -Force $profileDir | Out-Null
      Copy-Item "$env:SystemDrive\Users\Default\NTUSER.DAT" $ntuserDat -Force -ErrorAction SilentlyContinue
    }
  } else {
    Write-Ok "Profile already exists at $profileDir"
  }

  # Step 3: Set Shell in the kiosk user's NTUSER.DAT so only they get kiosk-shell.cmd.
  if (Test-Path $ntuserDat) {
    Write-Host "    Setting HKCU Shell in '$user' NTUSER.DAT..."
    $sid     = (Get-LocalUser -Name $user -ErrorAction SilentlyContinue).SID.Value
    $tempKey = "HKU\BrunoBockKioskSetup"

    # If the user is currently logged in, NTUSER.DAT is already loaded under HKU\<SID>.
    # Writing to it via reg load would fail with "file in use". Detect this and write directly.
    $hiveAlreadyLoaded = $sid -and (Test-Path "HKU:\$sid")

    if ($hiveAlreadyLoaded) {
      Write-Host "    User is currently logged in; writing directly to live HKU\$sid..."
      & reg add "HKU\$sid\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon" /v Shell /t REG_SZ /d $shellPath /f 2>&1 | Out-Null
      if ($LASTEXITCODE -eq 0) {
        Write-Ok "HKCU Shell set via live HKU\$sid key."
      } else {
        Write-Warn2 "Could not set HKCU Shell for '$user' via live hive."
      }
    } else {
      & reg load $tempKey $ntuserDat 2>&1 | Out-Null
      if ($LASTEXITCODE -eq 0) {
        & reg add "$tempKey\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon" /v Shell /t REG_SZ /d $shellPath /f 2>&1 | Out-Null
        [GC]::Collect(); [GC]::WaitForPendingFinalizers()
        for ($i = 0; $i -lt 5; $i++) {
          & reg unload $tempKey 2>&1 | Out-Null
          if ($LASTEXITCODE -eq 0) { break }
          Start-Sleep -Seconds 1
        }
        Write-Ok "HKCU Shell set to: $shellPath (kiosk user only)"
      } else {
        Write-Warn2 "Could not load NTUSER.DAT for '$user'. Kiosk shell may not apply until next reinstall."
      }
    }
  } else {
    Write-Warn2 "NTUSER.DAT not found at $ntuserDat -- kiosk shell not configured in HKCU."
  }

  # Step 4: Hide kiosk user from the sign-in screen - auto-login bypasses it anyway.
  $hideKey = "HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon\SpecialAccounts\UserList"
  if (-not (Test-Path $hideKey)) { New-Item -Path $hideKey -Force | Out-Null }
  Set-ItemProperty -Path $hideKey -Name $user -Type DWord -Value 0

  # Step 5: Disable the lock screen so it never blocks the kiosk display.
  $policyKey = "HKLM:\SOFTWARE\Policies\Microsoft\Windows\Personalization"
  if (-not (Test-Path $policyKey)) { New-Item -Path $policyKey -Force | Out-Null }
  Set-ItemProperty -Path $policyKey -Name "NoLockScreen" -Type DWord -Value 1

  Write-Ok "Kiosk shell configured."
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

function Enable-RDP {
  Write-Step "Enabling Remote Desktop (RDP)"

  # Enable RDP in the registry
  Set-ItemProperty -Path "HKLM:\SYSTEM\CurrentControlSet\Control\Terminal Server" `
    -Name "fDenyTSConnections" -Value 0 -Type DWord

  # Allow RDP through the firewall
  Enable-NetFirewallRule -DisplayGroup "Remote Desktop" -ErrorAction SilentlyContinue
  # Fallback for localised Windows builds
  netsh advfirewall firewall set rule group="remote desktop" new enable=Yes 2>$null | Out-Null

  # Require Network Level Authentication (NLA) — more secure
  Set-ItemProperty -Path "HKLM:\SYSTEM\CurrentControlSet\Control\Terminal Server\WinStations\RDP-Tcp" `
    -Name "UserAuthentication" -Value 1 -Type DWord

  Write-Ok "RDP enabled. Connect with: mstsc /v:$($env:COMPUTERNAME)"
}

function Configure-AutoLogin($cfg, $shellPath) {
  $doIt = $cfg.AutoLogin -or $EnableAutoLogin
  if (-not $doIt) {
    Write-Warn2 "Auto-login not configured (autoLogin=false in config). Kiosk user and shell NOT set up."
    return
  }
  Write-Step "Configuring auto-login and kiosk user"

  $user = $cfg.LoginUser
  $pass = $cfg.LoginPass

  # If password not in config, prompt (only happens in interactive fallback).
  if (-not $pass) {
    $pass = Read-SecurePin "Password for auto-login user '$user'"
  }

  # Create the user if it doesn't exist.
  if (-not (Get-LocalUser -Name $user -ErrorAction SilentlyContinue)) {
    Write-Host "    Creating local user '$user'..."
    $sec = ConvertTo-SecureString $pass -AsPlainText -Force
    New-LocalUser -Name $user -Password $sec -PasswordNeverExpires -UserMayNotChangePassword | Out-Null
    Add-LocalGroupMember -Group "Users" -Member $user -ErrorAction SilentlyContinue
    Write-Ok "User '$user' created."
  } else {
    Write-Ok "User '$user' already exists."
  }

  # Set Windows auto-login registry keys.
  $base = "HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon"
  Set-ItemProperty -Path $base -Name "AutoAdminLogon"  -Value "1"
  Set-ItemProperty -Path $base -Name "DefaultUserName" -Value $user
  Set-ItemProperty -Path $base -Name "DefaultPassword" -Value $pass
  Set-ItemProperty -Path $base -Name "DefaultDomainName" -Value $env:COMPUTERNAME
  # ForceAutoLogon re-arms auto-login on every boot so Windows cannot clear DefaultPassword.
  Set-ItemProperty -Path $base -Name "ForceAutoLogon"  -Value "1"
  Write-Ok "Auto-login enabled for '$user'."

  # Set HKCU Shell for kiosk user only (HKLM Shell stays as explorer.exe for Admin).
  if ($shellPath) {
    Configure-KioskShell $user $pass $shellPath
  }
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
  Write-Host " RDP access  : mstsc /v:$($env:COMPUTERNAME) (Admin user, port 3389)"
  Write-Host ""
}

function Rename-Machine($cfg) {
  $target = $cfg.MatchHostname
  if (-not $target) { return }
  if ($env:COMPUTERNAME -ieq $target) {
    Write-Ok "Hostname is already '$target'."
    return
  }
  Write-Step "Renaming computer to '$target' (was '$env:COMPUTERNAME')"
  Rename-Computer -NewName $target -Force -ErrorAction Stop
  Write-Ok "Computer renamed. A reboot is required for the new name to take effect."
  $script:NeedsReboot = $true
}

# --- Main ---
$script:NeedsReboot = $false
Assert-Admin
if (-not $SkipPrereqs) { Install-Prereqs }
Stage-App
Install-Deps
$cfg     = Get-Config
Rename-Machine $cfg
$pinHash = Hash-Pin $cfg
Write-EnvFile $cfg $pinHash
Build-App
Run-Migrations
Install-Service
Apply-EdgePolicies
Enable-RDP
$shellPath = Write-KioskShellScript $cfg.Port $cfg.LoginUser
Disable-Sleep
Register-BackupTask $cfg
Configure-AutoLogin $cfg $shellPath
Print-Summary $cfg
if ($script:NeedsReboot) {
  Write-Host ""
  Write-Host "  *** REBOOT REQUIRED to apply new hostname '$($cfg.MatchHostname)'. ***" -ForegroundColor Yellow
  Write-Host ""
}
