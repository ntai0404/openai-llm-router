$ErrorActionPreference="Stop"
. "$PSScriptRoot\scripts\router-common.ps1"
Ensure-RouterState
$node=Get-Command node.exe -ErrorAction SilentlyContinue
if(-not $node){$node=Get-Command node -ErrorAction SilentlyContinue}
if(-not $node){throw "Node.js is not installed or not in PATH."}
if(-not (Test-Path $script:BridgePath)){throw "Router backend missing: $script:BridgePath"}
$key=Get-RouterKey
if(-not $key){throw "Authentication is not configured. Run .\setup.ps1 first."}
$pidValue=$null
if(Test-Path $script:PidPath){$raw=(Get-Content $script:PidPath -Raw).Trim();$n=0;if([int]::TryParse($raw,[ref]$n)){$pidValue=$n}}
if($pidValue){$p=Get-CimInstance Win32_Process -Filter ("ProcessId="+$pidValue) -ErrorAction SilentlyContinue;if($p -and $p.Name -eq "node.exe" -and $p.CommandLine -match "demo-browser-bridge\.mjs"){$h=Get-RouterHealth;if($h){Write-Host ("ROUTER START  PASS (already running, PID "+$pidValue+")");exit 0}};Remove-Item $script:PidPath -Force -ErrorAction SilentlyContinue}
try{$listener=Get-NetTCPConnection -LocalPort 8788 -State Listen -ErrorAction Stop|Select-Object -First 1}catch{$listener=$null}
if($listener){$owner=[int]$listener.OwningProcess;$p=Get-CimInstance Win32_Process -Filter ("ProcessId="+$owner) -ErrorAction SilentlyContinue;if($p -and $p.Name -eq "node.exe" -and $p.CommandLine -match "demo-browser-bridge\.mjs"){throw "An unmanaged router is already running on port 8788 (PID $owner). Run .\stop.ps1 before managed start."};throw "Port 8788 is already in use by unrelated PID $owner."}
$out=Join-Path $script:StateDir "router.out.log"
$err=Join-Path $script:StateDir "router.err.log"
$hadShellRouterKey=Test-Path Env:ROUTER_API_KEY
$previousShellRouterKey=$env:ROUTER_API_KEY
$env:ROUTER_API_KEY=$key
try {
    # ROUTER_CHILD_ENV_V1
    $p=Start-Process -FilePath $node.Source -ArgumentList @("`"$script:BridgePath`"") -WorkingDirectory $script:StateDir -WindowStyle Hidden -RedirectStandardOutput $out -RedirectStandardError $err -PassThru
} finally {
    if($hadShellRouterKey){ $env:ROUTER_API_KEY=$previousShellRouterKey } else { Remove-Item Env:ROUTER_API_KEY -ErrorAction SilentlyContinue }
}
Set-Content $script:PidPath $p.Id -Encoding ascii
$ready=$false
for($i=0;$i -lt 40;$i++){Start-Sleep -Milliseconds 500;if(-not (Get-Process -Id $p.Id -ErrorAction SilentlyContinue)){break};$h=Get-RouterHealth;if($h){$ready=$true;break}}
if(-not $ready){Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue;Remove-Item $script:PidPath -Force -ErrorAction SilentlyContinue;$tail="";if(Test-Path $err){$tail=(Get-Content $err -Tail 10 -ErrorAction SilentlyContinue)-join "`n"};throw "Router failed to start. $tail"}
Write-Host "ROUTER START  PASS"
Write-Host ("PID                   "+$p.Id)
Write-Host ("Endpoint              "+$script:BaseUrl)
Write-Host ("Extension connected   "+$h.extension_connected)
