param([switch]$KeepCredential,[switch]$KeepLogs)
$ErrorActionPreference="Stop"
. "$PSScriptRoot\scripts\router-common.ps1"
Ensure-RouterState
$backupDir=Join-Path $script:StateDir "backups"
New-Item $backupDir -ItemType Directory -Force|Out-Null
$stamp=Get-Date -Format "yyyyMMdd-HHmmss"
Write-Host ""
Write-Host "Uninstall Local Responses Provider"
Write-Host "=================================="
& "$PSScriptRoot\stop.ps1"
$configPath=Join-Path $script:StateDir "provider.json"
if(Test-Path $configPath){Copy-Item $configPath (Join-Path $backupDir ("provider.json.uninstall."+$stamp+".bak")) -Force;Remove-Item $configPath -Force;Write-Host "Provider config        REMOVED"}else{Write-Host "Provider config        NOT PRESENT"}
if(Test-Path $script:CompatPath){Remove-Item $script:CompatPath -Force}
Remove-Item $script:PidPath -Force -ErrorAction SilentlyContinue
if(-not $KeepCredential){if(Test-Path $script:EnvPath){Copy-Item $script:EnvPath (Join-Path $backupDir (".env.uninstall."+$stamp+".bak")) -Force;Remove-Item $script:EnvPath -Force;Write-Host "Credential             REMOVED"}else{Write-Host "Credential             NOT PRESENT"}}else{Write-Host "Credential             KEPT"}
if(-not $KeepLogs){Remove-Item (Join-Path $script:StateDir "router.out.log"),(Join-Path $script:StateDir "router.err.log") -Force -ErrorAction SilentlyContinue}
Write-Host "Repository source      UNCHANGED"
Write-Host "UNINSTALL              PASS"
