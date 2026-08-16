
# ROUTER_PREEXISTING_CONFIG_V1
$__routerInstallStateDir = Join-Path $env:LOCALAPPDATA "OpenAIResponsesRouter"
$__routerInstallProvider = Join-Path $__routerInstallStateDir "provider.json"
$__routerInstallBackup = Join-Path $__routerInstallStateDir "provider.preinstall.json"
$__routerInstallState = Join-Path $__routerInstallStateDir "provider.install-state.json"
New-Item $__routerInstallStateDir -ItemType Directory -Force | Out-Null
if (-not (Test-Path $__routerInstallState)) {
  $hadPreexisting = Test-Path $__routerInstallProvider
  $alreadyManaged = $false
  if ($hadPreexisting) {
    try {
      $existingProvider = Get-Content $__routerInstallProvider -Raw | ConvertFrom-Json
    } catch {
      throw "Existing provider config is invalid JSON; setup left it unchanged."
    }
    $alreadyManaged = ($existingProvider.installer_managed -eq $true)
  }
  if ($hadPreexisting -and -not $alreadyManaged) {
    Copy-Item $__routerInstallProvider $__routerInstallBackup -Force
    $state = [ordered]@{ version = 1; had_preexisting = $true }
  } else {
    Remove-Item $__routerInstallBackup -Force -ErrorAction SilentlyContinue
    $state = [ordered]@{ version = 1; had_preexisting = $false }
  }
  [IO.File]::WriteAllText($__routerInstallState, ($state | ConvertTo-Json -Compress), [Text.UTF8Encoding]::new($false))
}
$ErrorActionPreference="Stop"
. "$PSScriptRoot\scripts\router-common.ps1"
Write-Host ""
Write-Host "Local Responses Provider Setup"
Write-Host "=============================="
$node=Get-Command node.exe -ErrorAction SilentlyContinue
if(-not $node){$node=Get-Command node -ErrorAction SilentlyContinue}
if(-not $node){throw "Node.js is required."}
Write-Host ("Node/runtime           PASS ("+(& $node.Source --version)+")")
foreach($p in @($script:BridgePath,$script:ManifestPath)){if(-not (Test-Path $p)){throw "Missing required file: $p"}}
Write-Host "Installation files     PASS"
Ensure-RouterState
$backupDir=Join-Path $script:StateDir "backups"
New-Item $backupDir -ItemType Directory -Force|Out-Null
$key=Get-RouterKey
if(-not $key){$bytes=New-Object byte[] 24;$rng=[Security.Cryptography.RandomNumberGenerator]::Create();try{$rng.GetBytes($bytes)}finally{$rng.Dispose()};$hex=-join($bytes|ForEach-Object{$_.ToString("x2")});$key="rt_"+$hex;if(Test-Path $script:EnvPath){Copy-Item $script:EnvPath (Join-Path $backupDir (".env."+(Get-Date -Format "yyyyMMdd-HHmmss")+".bak")) -Force};Set-Content $script:EnvPath ("ROUTER_API_KEY="+$key) -Encoding ascii}
Write-Host ("Authentication         PASS ("+(Format-RouterKey $key)+")")
$configPath=Join-Path $script:StateDir "provider.json"
if(Test-Path $configPath){$stamp=Get-Date -Format "yyyyMMdd-HHmmss";Copy-Item $configPath (Join-Path $backupDir ("provider.json."+$stamp+".bak")) -Force;try{$cfg=Get-Content $configPath -Raw|ConvertFrom-Json}catch{throw "Existing provider.json is invalid JSON; backup created and file was not overwritten."}}else{$cfg=[pscustomobject]@{}}
$wanted=[ordered]@{provider_id="chatgpt-web-local";base_url=$script:BaseUrl;protocol="responses";credential_source="local_env_file";credential_env="ROUTER_API_KEY";stream_timeout_ms=300000;installer_managed=$true}
foreach($x in $wanted.GetEnumerator()){if($cfg.PSObject.Properties[$x.Key]){$cfg.PSObject.Properties[$x.Key].Value=$x.Value}else{$cfg|Add-Member -NotePropertyName $x.Key -NotePropertyValue $x.Value}}
$cfg|ConvertTo-Json -Depth 20|Set-Content $configPath -Encoding utf8
Write-Host "Provider config        PASS"
Write-Host ("Base URL               "+$script:BaseUrl)
$h=Get-RouterHealth
if($h){Write-Host "Existing router        DETECTED";& "$PSScriptRoot\stop.ps1"}
& "$PSScriptRoot\start.ps1"
Start-Sleep -Milliseconds 500
$h=Get-RouterHealth
if(-not $h){throw "Router /health is unreachable after managed start."}
Write-Host "Router                 PASS"
if(-not $h.extension_connected){Write-Host "Extension              FAIL";throw "Chrome extension is not connected."}
Write-Host "Extension              PASS"
Write-Host ""
Write-Host "SETUP                  PASS"
Write-Host ("Config                 "+$configPath)
Write-Host ("Credential             "+(Format-RouterKey $key))
Write-Host ("Endpoint               "+$script:BaseUrl)
