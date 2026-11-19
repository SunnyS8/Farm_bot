$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$statusFile = Join-Path $root '.state\tunnel.json'
if (-not (Test-Path $statusFile)) { Write-Output 'No tunnel status file'; exit 0 }
$status = Get-Content -Raw $statusFile | ConvertFrom-Json
if ($status.status -ne 'ready') { Write-Output 'Tunnel not marked ready'; exit 0 }
$workerId = [int]$status.pid
$worker = Get-CimInstance Win32_Process -Filter "ProcessId=$workerId"
if (-not $worker) { Write-Output 'Worker already stopped'; exit 0 }
$node = Join-Path $env:LOCALAPPDATA 'Programs\nodejs\node.exe'
$scriptPath = Join-Path $root 'scripts\tunnel.mjs'
if ($worker.ExecutablePath -ne $node -or
    -not $worker.CommandLine.Contains($scriptPath) -or
    -not $worker.CommandLine.Contains('--worker')) {
    throw 'PID identity mismatch; refusing to stop an unrelated process'
}
# Only this verified user-owned worker and its cloudflared child; no services/PATH/firewall.
& "$env:SystemRoot\System32\taskkill.exe" /PID $workerId /T /F
