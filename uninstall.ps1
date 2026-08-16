param([switch]$KeepCredential,[switch]$KeepLogs)
# ROUTER_PREEXISTING_RESTORE_V1
$__routerRestoreStateDir = Join-Path $env:LOCALAPPDATA "OpenAIResponsesRouter"
$__routerRestoreProvider = Join-Path $__routerRestoreStateDir "provider.json"
$__routerRestoreBackup = Join-Path $__routerRestoreStateDir "provider.preinstall.json"
$__routerRestoreState = Join-Path $__routerRestoreStateDir "provider.install-state.json"
$__routerRestoreHadPreexisting = $false
$__routerRestoreBytes = $null
if (Test-Path $__routerRestoreState) {
  try {
    $__routerRestoreMeta = Get-Content $__routerRestoreState -Raw | ConvertFrom-Json
    $__routerRestoreHadPreexisting = ($__routerRestoreMeta.had_preexisting -eq $true)
  } catch {
    throw "Cannot uninstall safely: provider install-state is invalid."
  }
  if ($__routerRestoreHadPreexisting) {
    if (-not (Test-Path $__routerRestoreBackup)) {
      throw "Cannot uninstall safely: pre-existing provider backup is missing."
    }
    $__routerRestoreBytes = [IO.File]::ReadAllBytes($__routerRestoreBackup)
  }
}

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

# ROUTER_PREEXISTING_RESTORE_FINAL_V1
if ($__routerRestoreHadPreexisting -and $null -ne $__routerRestoreBytes) {
  New-Item $__routerRestoreStateDir -ItemType Directory -Force | Out-Null
  [IO.File]::WriteAllBytes($__routerRestoreProvider, $__routerRestoreBytes)
  Write-Host "Provider config        RESTORED"
}
Remove-Item $__routerRestoreBackup -Force -ErrorAction SilentlyContinue
Remove-Item $__routerRestoreState -Force -ErrorAction SilentlyContinue
