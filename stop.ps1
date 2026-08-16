$ErrorActionPreference="Stop"
. "$PSScriptRoot\scripts\router-common.ps1"
$targets=@()
$pidValue=$null
if(Test-Path $script:PidPath){ $raw=(Get-Content $script:PidPath -Raw).Trim(); $n=0; if([int]::TryParse($raw,[ref]$n)){ $pidValue=$n } }
if($pidValue){ $p=Get-CimInstance Win32_Process -Filter "ProcessId=$pidValue" -ErrorAction SilentlyContinue; if($p -and $p.Name -eq "node.exe" -and $p.CommandLine -match "demo-browser-bridge\.mjs"){ $targets+= $p } }
if($targets.Count -eq 0){ try { $listener=Get-NetTCPConnection -LocalPort 8788 -State Listen -ErrorAction Stop | Select-Object -First 1; $p=Get-CimInstance Win32_Process -Filter ("ProcessId="+$listener.OwningProcess) -ErrorAction SilentlyContinue; if($p -and $p.Name -eq "node.exe" -and $p.CommandLine -match "demo-browser-bridge\.mjs"){ $targets+= $p } elseif($listener){ throw ("Port 8788 belongs to unrelated PID "+$listener.OwningProcess) } } catch { if($_.Exception.Message -like "Port 8788 belongs*"){ throw } } }
foreach($p in ($targets | Sort-Object ProcessId -Unique)){ Stop-Process -Id $p.ProcessId -Force -ErrorAction Stop; Write-Host ("Stopped router PID "+$p.ProcessId) }
Remove-Item $script:PidPath -Force -ErrorAction SilentlyContinue
Start-Sleep -Milliseconds 300
$h=Get-RouterHealth
if($h){ throw "Router endpoint is still reachable after stop." }
if($targets.Count -eq 0){ Write-Host "ROUTER STOP  PASS (already stopped)" } else { Write-Host "ROUTER STOP  PASS" }
