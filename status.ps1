$ErrorActionPreference="Stop"
. "$PSScriptRoot\scripts\router-common.ps1"
$health=Get-RouterHealth
$pidValue=$null
if(Test-Path $script:PidPath){ $raw=(Get-Content $script:PidPath -Raw).Trim(); $n=0; if([int]::TryParse($raw,[ref]$n)){ $pidValue=$n } }
$managed=$false
if($pidValue){ $managed=[bool](Get-Process -Id $pidValue -ErrorAction SilentlyContinue) }
$listener=$null
try { $listener=Get-NetTCPConnection -LocalPort 8788 -State Listen -ErrorAction Stop | Select-Object -First 1 } catch {}
$running=[bool]$listener
$key=Get-RouterKey
$compat=$null
if(Test-Path $script:CompatPath){ try { $compat=Get-Content $script:CompatPath -Raw | ConvertFrom-Json } catch {} }
Write-Host ""
Write-Host "Local Responses Provider"
Write-Host "------------------------"
Write-Host ("Router process        "+$(if($running){if($managed){"RUNNING"}else{"RUNNING (UNMANAGED)"} }else{"STOPPED"}))
Write-Host ("HTTP endpoint         "+$(if($health){"REACHABLE"}else{"UNREACHABLE"}))
Write-Host ("Extension connected   "+$(if($health -and $health.extension_connected){"YES"}else{"NO"}))
$worker="UNAVAILABLE"
if($health -and $health.extension_connected){ if($health.worker_busy){$worker="BUSY"}else{$worker="AVAILABLE"} }
Write-Host ("Worker                "+$worker)
Write-Host ("Authentication        "+$(if($key){"CONFIGURED"}else{"NOT CONFIGURED"}))
if($key){ Write-Host ("router_key            "+(Format-RouterKey $key)) }
Write-Host ("Base URL              "+$script:BaseUrl)
Write-Host ("Compatibility         "+$(if($compat){$compat.status}else{"NOT CHECKED"}))
if($pidValue){ Write-Host ("Managed PID           "+$pidValue) } elseif($listener){ Write-Host ("Listening PID         "+$listener.OwningProcess) }
