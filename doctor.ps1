$ErrorActionPreference="Stop"
. "$PSScriptRoot\scripts\router-common.ps1"
Ensure-RouterState
$compat=[ordered]@{status="FAIL";checked_at=(Get-Date).ToString("o");failure_layer=$null}
function Save-Compat { param([string]$Status,[string]$Layer=$null); $compat.status=$Status; $compat.failure_layer=$Layer; $compat|ConvertTo-Json -Depth 10|Set-Content $script:CompatPath -Encoding utf8 }
function Fail([string]$Layer,[string]$Message){ Write-Host ($Layer.PadRight(23)+"FAIL - "+$Message); Save-Compat "FAIL" $Layer; throw $Message }
Write-Host ""
Write-Host "Provider diagnostics"
Write-Host "--------------------"
$configPath=Join-Path $script:StateDir "provider.json"
if(-not (Test-Path $configPath)){Fail "Provider config" "provider.json missing"}
try{$cfg=Get-Content $configPath -Raw|ConvertFrom-Json}catch{Fail "Provider config" "provider.json invalid JSON"}
if($cfg.base_url -ne $script:BaseUrl -or $cfg.protocol -ne "responses"){Fail "Provider config" "stable endpoint/protocol mismatch"}
Write-Host "Provider config        PASS"
$key=Get-RouterKey
if(-not $key){Fail "Authentication" "ROUTER_API_KEY missing"}
Write-Host "Authentication         PASS"
$h=Get-RouterHealth
if(-not $h){Fail "Router" "/health unreachable"}
Write-Host "Router                 PASS"
if(-not $h.extension_connected){Fail "Extension" "extension websocket not connected"}
Write-Host "Extension              PASS"
if($h.worker_busy){Fail "Browser worker" "worker busy"}
Write-Host "Browser worker         PASS"
$headers=@{Authorization=("Bearer "+$key);"Content-Type"="application/json"}
$body=@{model="requested-model-unverified";input="Reply exactly DOCTOR_NON_STREAM_OK.";stream=$false}|ConvertTo-Json -Depth 20
try{$r=Invoke-RestMethod -Uri ($script:BaseUrl+"/responses") -Method Post -Headers $headers -Body $body -TimeoutSec 320}catch{Fail "Responses API" $_.Exception.Message}
if($r.status -ne "completed"){Fail "Responses API" "non-stream response not completed"}
Write-Host "Responses API          PASS"
$body=@{model="requested-model-unverified";input="Reply exactly DOCTOR_SSE_OK.";stream=$true}|ConvertTo-Json -Depth 20
try{$s=Invoke-WebRequest -UseBasicParsing -Uri ($script:BaseUrl+"/responses") -Method Post -Headers $headers -Body $body -TimeoutSec 320}catch{Fail "SSE" $_.Exception.Message}
$events=@([regex]::Matches([string]$s.Content,"(?m)^event:\s*(.+)$")|ForEach-Object{$_.Groups[1].Value.Trim()})
if($events -contains "error" -or -not ($events -contains "response.created") -or -not ($events -contains "response.completed")){Fail "SSE" ("bad lifecycle: "+($events -join " -> "))}
Write-Host "SSE                    PASS"
$tool=@{type="function";name="router_doctor_probe";description="Harmless external-router doctor probe.";strict=$true;parameters=@{type="object";properties=@{code=@{type="string";enum=@("PING")}};required=@("code");additionalProperties=$false}}
$req1=@{model="requested-model-unverified";instructions="Use the supplied external-router function. The external client executes it.";input="Request router_doctor_probe with code PING.";tools=@($tool);tool_choice=@{type="function";name="router_doctor_probe"};parallel_tool_calls=$false;stream=$false}|ConvertTo-Json -Depth 30
try{$t1=Invoke-RestMethod -Uri ($script:BaseUrl+"/responses") -Method Post -Headers $headers -Body $req1 -TimeoutSec 320}catch{Fail "Function tools" $_.Exception.Message}
$calls=@($t1.output|Where-Object{$_.type -eq "function_call"})
if($calls.Count -ne 1){Fail "Function tools" ("expected 1 call, got "+$calls.Count)}
$call=$calls[0]
if($call.name -ne "router_doctor_probe"){Fail "Function tools" ("wrong function "+$call.name)}
try{$args=$call.arguments|ConvertFrom-Json}catch{Fail "Function tools" "arguments invalid JSON"}
if($args.code -ne "PING"){Fail "Function tools" "argument round-trip mismatch"}
$input=@(@{role="user";content=@(@{type="input_text";text="Run harmless doctor tool-loop probe."})},@{id=$call.id;type="function_call";status=$(if($call.status){$call.status}else{"completed"});name=$call.name;call_id=$call.call_id;arguments=$call.arguments},@{type="function_call_output";call_id=$call.call_id;output="PONG"})
$req2=@{model="requested-model-unverified";instructions="Trust the previous external-router function result and reply exactly DOCTOR_TOOL_LOOP_OK.";input=$input;tools=@($tool);tool_choice="none";parallel_tool_calls=$false;stream=$false}|ConvertTo-Json -Depth 30
try{$t2=Invoke-RestMethod -Uri ($script:BaseUrl+"/responses") -Method Post -Headers $headers -Body $req2 -TimeoutSec 320}catch{Fail "Function tools" $_.Exception.Message}
if($t2.status -ne "completed"){Fail "Function tools" "function_call_output replay did not complete"}
Write-Host "Function tools         PASS"
$compat.responses_non_stream=$true;$compat.sse=$true;$compat.function_tools=$true;Save-Compat "PASS" $null
Write-Host ""
Write-Host "READY"

# ROUTER_DOCTOR_PROTOCOL_V1
$protocolHealth = try { Get-RouterHealth } catch { $null }
$protocolCheck = Test-RouterProtocolCompatibility -Health $protocolHealth
if (-not $protocolCheck.Compatible) {
  Save-Compat "FAIL" "Protocol compatibility"
  throw ("Protocol compatibility: " + $protocolCheck.Message)
}
Write-Host (("Protocol compatibility").PadRight(23) + "PASS")
Save-Compat "PASS" "Protocol compatibility"
