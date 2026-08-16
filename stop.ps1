param()
$ErrorActionPreference = "Stop"
. "$PSScriptRoot\scripts\router-common.ps1"

function Test-Health {
  try { return $null -ne (Get-RouterHealth) } catch { return $false }
}

function Get-ListenerPids {
  return @(Get-NetTCPConnection -State Listen -LocalPort 8788 -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique)
}

function Get-BridgeProcess([int]$ProcessId) {
  if ($ProcessId -le 0) { return $null }
  $p = Get-CimInstance Win32_Process -Filter "ProcessId=$ProcessId" -ErrorAction SilentlyContinue
  if (-not $p) { return $null }
  $cmd = ([string]$p.CommandLine).Replace("\","/").ToLowerInvariant()
  $bridge = ([string]$BridgePath).Replace("\","/").ToLowerInvariant()
  $leaf = (Split-Path $BridgePath -Leaf).ToLowerInvariant()
  if ($cmd.Contains($bridge) -or $cmd.Contains($leaf)) { return $p }
  return $null
}

Ensure-RouterState

$targets = New-Object System.Collections.Generic.HashSet[int]

if (Test-Path $PidPath) {
  $raw = (Get-Content $PidPath -Raw -ErrorAction SilentlyContinue).Trim()
  $managed = 0
  if ([int]::TryParse($raw,[ref]$managed)) {
    if (Get-BridgeProcess $managed) { [void]$targets.Add($managed) }
  }
}

foreach ($listenerPid in (Get-ListenerPids)) {
  $bridgeProc = Get-BridgeProcess ([int]$listenerPid)
  if ($bridgeProc) {
    [void]$targets.Add([int]$listenerPid)
  } else {
    throw "Port 8788 is owned by unrelated PID $listenerPid; refusing to stop it."
  }
}

if ($targets.Count -eq 0) {
  Remove-Item $PidPath -Force -ErrorAction SilentlyContinue
  if (Test-Health) { throw "Router health is reachable but no verified bridge process owns port 8788." }
  Write-Host "ROUTER STOP  PASS (already stopped)"
  exit 0
}

foreach ($targetPid in $targets) {
  Write-Host "Stopping verified router PID $targetPid"
  Stop-Process -Id $targetPid -Force -ErrorAction Stop
}

for ($i=0; $i -lt 20; $i++) {
  if (-not (Test-Health)) { break }
  Start-Sleep -Milliseconds 500
}

if (Test-Health) { throw "Router is still reachable after stopping verified process." }

Remove-Item $PidPath -Force -ErrorAction SilentlyContinue
Write-Host "ROUTER STOP  PASS"
