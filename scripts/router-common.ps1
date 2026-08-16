Set-StrictMode -Version Latest
$script:RouterRoot = Split-Path -Parent $PSScriptRoot
$script:RouterDir = Join-Path $script:RouterRoot "router"
$script:BridgePath = Join-Path $script:RouterDir "demo-browser-bridge.mjs"
$script:ManifestPath = Join-Path $script:RouterRoot "chrome-extension\manifest.json"
$script:StateDir = Join-Path $env:LOCALAPPDATA "OpenAIResponsesRouter"
$script:EnvPath = Join-Path $script:StateDir ".env"
$script:PidPath = Join-Path $script:StateDir "router.pid"
$script:CompatPath = Join-Path $script:StateDir "compatibility.json"
$script:BaseUrl = "http://127.0.0.1:8788/v1"
$script:HealthUrl = "http://127.0.0.1:8788/health"
function Ensure-RouterState { New-Item -ItemType Directory -Path $script:StateDir -Force | Out-Null }
function Get-RouterHealth { try { Invoke-RestMethod -Uri $script:HealthUrl -TimeoutSec 4 } catch { $null } }
function Get-RouterKey { if(-not (Test-Path $script:EnvPath)){ return $null }; $m=[regex]::Match((Get-Content $script:EnvPath -Raw),"(?m)^ROUTER_API_KEY=(.+)$"); if($m.Success){ $m.Groups[1].Value.Trim() } else { $null } }
function Format-RouterKey([string]$k){ if([string]::IsNullOrWhiteSpace($k)){ return "<not-configured>" }; if($k.Length -le 8){ return "****" }; return ($k.Substring(0,3)+"****"+$k.Substring($k.Length-4)) }

# ROUTER_PROTOCOL_COMPAT_V1
function Test-RouterProtocolCompatibility {
  param(
    $Health,
    [string]$ExpectedProtocol = "responses-v1"
  )

  $issues = @()
  $routerVersion = ""
  $extensionVersion = ""
  $routerProtocol = ""
  $extensionProtocol = ""

  if ($null -eq $Health) {
    $issues += "health unavailable"
  } else {
    $routerVersion = [string]$Health.router_version
    $extensionVersion = [string]$Health.extension_version
    $routerProtocol = [string]$Health.protocol_version
    $extensionProtocol = [string]$Health.extension_protocol_version
    if (-not $Health.extension_connected) { $issues += "extension disconnected" }
    if ([string]::IsNullOrWhiteSpace($routerVersion)) { $issues += "router_version missing" }
    if ([string]::IsNullOrWhiteSpace($extensionVersion)) { $issues += "extension_version missing" }
    if ($routerProtocol -ne $ExpectedProtocol) { $issues += "router protocol=$routerProtocol expected=$ExpectedProtocol" }
    if ($extensionProtocol -ne $ExpectedProtocol) { $issues += "extension protocol=$extensionProtocol expected=$ExpectedProtocol" }
    if ($Health.protocol_compatible -ne $true) { $issues += "health protocol_compatible=false" }
  }

  [pscustomobject]@{
    Compatible = ($issues.Count -eq 0)
    RouterVersion = $routerVersion
    ExtensionVersion = $extensionVersion
    RouterProtocol = $routerProtocol
    ExtensionProtocol = $extensionProtocol
    Message = ($issues -join "; ")
  }
}
