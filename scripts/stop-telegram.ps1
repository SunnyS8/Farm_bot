$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$statusFile = Join-Path $root '.state\telegram-worker.json'
$lock = Join-Path $root '.state\telegram-worker.lock'
if (-not (Test-Path $statusFile)) { Write-Output 'No owned Telegram worker state'; exit 0 }
$status = Get-Content -Raw $statusFile | ConvertFrom-Json
$workerId = [int]$status.pid
if ($workerId -le 0) { throw 'Invalid worker PID' }
$worker = Get-CimInstance Win32_Process -Filter "ProcessId=$workerId"
if ($worker) {
    $node = Join-Path $env:LOCALAPPDATA 'Programs\nodejs\node.exe'
    $scriptPath = Join-Path $root 'scripts\telegram-worker.mjs'
    if ($worker.ExecutablePath -ne $node -or
        -not $worker.CommandLine.Contains($scriptPath) -or
        -not $worker.CommandLine.Contains('--worker')) {
        throw 'PID identity mismatch; refusing to stop an unrelated process'
    }
    Stop-Process -Id $workerId -Force
}
if (Test-Path $lock) { Remove-Item -LiteralPath $lock -Force }
@{ status = 'stopped'; pid = $workerId } | ConvertTo-Json | Set-Content -Encoding UTF8 $statusFile
Write-Output 'Owned Telegram worker stopped'
