# Wolfcanvas Postgres backup — dumps the database the app connects to (from .env),
# keeps the last 14 dumps in /backups. Run daily via a scheduled task or
# `npm run backup`.
$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$envFile = Join-Path $root ".env"
$backupDir = Join-Path $root "backups"
$keepDays = 14

if (-not (Test-Path $envFile)) { Write-Error "No .env file at $envFile"; exit 1 }

$dbUrl = $null
Get-Content $envFile | ForEach-Object {
  if ($_ -match '^DATABASE_URL=(.*)$') { $dbUrl = $Matches[1].Trim() }
}
if (-not $dbUrl) { Write-Error "DATABASE_URL not found in $envFile"; exit 1 }

# Locate pg_dump — on PATH or under Program Files\PostgreSQL\<version>\bin
$pgDumpPath = $null
$cmd = Get-Command pg_dump -ErrorAction SilentlyContinue
if ($cmd) { $pgDumpPath = $cmd.Source }
if (-not $pgDumpPath) {
  $versions = Get-ChildItem "C:\Program Files\PostgreSQL" -Directory -ErrorAction SilentlyContinue |
    Sort-Object Name -Descending
  foreach ($v in $versions) {
    $candidate = Join-Path $v.FullName "bin\pg_dump.exe"
    if (Test-Path $candidate) { $pgDumpPath = $candidate; break }
  }
}
if (-not $pgDumpPath) { Write-Error "pg_dump not found on PATH or in C:\Program Files\PostgreSQL"; exit 1 }

New-Item -ItemType Directory -Force -Path $backupDir | Out-Null
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$out = Join-Path $backupDir "wolfcanvas-$stamp.sql"

& $pgDumpPath $dbUrl --format=plain --no-owner --no-privileges --file=$out
if ($LASTEXITCODE -ne 0) { Write-Error "pg_dump failed with exit code $LASTEXITCODE"; exit 1 }

# Prune old backups
$pruned = @(Get-ChildItem $backupDir -Filter "wolfcanvas-*.sql" -ErrorAction SilentlyContinue |
  Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-$keepDays) } | Remove-Item -Force)

$count = @(Get-ChildItem $backupDir -Filter "wolfcanvas-*.sql" -ErrorAction SilentlyContinue).Count
Write-Host "Backup OK: $out"
Write-Host "Kept $count backup(s) (prune older than $keepDays days)."