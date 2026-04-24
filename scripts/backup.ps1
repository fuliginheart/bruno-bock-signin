<#
.SYNOPSIS
  Daily SQLite backup of the leader DB to a configured destination.

.DESCRIPTION
  Uses SQLite's online backup API via better-sqlite3 by invoking a small
  Node one-liner. Run via Task Scheduler, e.g. nightly at 02:00.
#>
param(
  [string] $InstallDir = "C:\BrunoBock",
  [string] $DbPath     = "C:\BrunoBock\data\db.sqlite",
  [string] $BackupDir  = "C:\BrunoBock\backups",
  [int]    $KeepDays   = 30
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path $BackupDir)) { New-Item -ItemType Directory -Path $BackupDir | Out-Null }
$ts   = Get-Date -Format "yyyyMMdd-HHmmss"
$dest = Join-Path $BackupDir "db-$ts.sqlite"

Push-Location $InstallDir
try {
  & node -e "const Db=require('better-sqlite3'); const s=new Db(process.argv[1],{readonly:true}); s.backup(process.argv[2]).then(()=>{s.close()}).catch(e=>{console.error(e);process.exit(1)})" `
    $DbPath $dest
  if ($LASTEXITCODE -ne 0) { throw "backup failed." }
} finally { Pop-Location }

Write-Host "Backed up to $dest"

# Prune old backups.
Get-ChildItem -Path $BackupDir -Filter "db-*.sqlite" |
  Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-$KeepDays) } |
  Remove-Item -Force
