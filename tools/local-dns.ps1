[CmdletBinding()]
param(
  [ValidateSet("install", "remove", "status")]
  [string]$Action = "status",
  [string[]]$Hostnames = @("mlbb.local", "api.mlbb.local", "obs.mlbb.local"),
  [string]$Address = "127.0.0.1"
)

$ErrorActionPreference = "Stop"
$hostsPath = Join-Path $env:SystemRoot "System32\drivers\etc\hosts"
$beginMarker = "# BEGIN MLBB Co-Pilot local DNS"
$endMarker = "# END MLBB Co-Pilot local DNS"

function Test-IsAdministrator {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = [Security.Principal.WindowsPrincipal]::new($identity)
  return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Normalize-Hostnames([string[]]$Names) {
  $set = [ordered]@{}
  foreach ($name in $Names) {
    $normalized = $name.Trim().ToLowerInvariant()
    if ($normalized -and -not $set.Contains($normalized)) {
      $set[$normalized] = $true
    }
  }
  return @($set.Keys)
}

function Read-HostsFile {
  if (Test-Path -LiteralPath $hostsPath) {
    return Get-Content -LiteralPath $hostsPath -Raw
  }
  return ""
}

function Remove-ManagedBlock([string]$Content) {
  $pattern = "(?ms)^# BEGIN MLBB Co-Pilot local DNS\r?\n.*?^# END MLBB Co-Pilot local DNS\r?\n?"
  return [regex]::Replace($Content, $pattern, "")
}

function Flush-DnsCache {
  $command = Get-Command Clear-DnsClientCache -ErrorAction SilentlyContinue
  if ($command) {
    Clear-DnsClientCache
  }
}

$Hostnames = Normalize-Hostnames $Hostnames
if (-not $Hostnames.Length) {
  throw "At least one hostname is required."
}

$content = Read-HostsFile

if ($Action -eq "status") {
  Write-Host "Hosts file: $hostsPath"
  foreach ($hostname in $Hostnames) {
    $pattern = "(?im)^\s*[0-9a-fA-F:\.]+\s+.*\b$([regex]::Escape($hostname))\b"
    $state = if ($content -match $pattern) { "mapped" } else { "missing" }
    Write-Host ("{0,-18} {1}" -f $hostname, $state)
  }
  return
}

if (-not (Test-IsAdministrator)) {
  throw "Updating the Windows hosts file requires an elevated PowerShell. Re-run this command as Administrator."
}

$clean = Remove-ManagedBlock $content
if ($Action -eq "install") {
  $line = "$Address`t$($Hostnames -join " ")"
  $block = "$beginMarker`r`n$line`r`n$endMarker`r`n"
  $next = $clean.TrimEnd() + "`r`n`r`n" + $block
  Set-Content -LiteralPath $hostsPath -Value $next -Encoding ASCII
  Flush-DnsCache
  Write-Host "Installed local DNS hostnames:"
  foreach ($hostname in $Hostnames) {
    Write-Host "  http://$hostname"
  }
  return
}

$next = $clean.TrimEnd() + "`r`n"
Set-Content -LiteralPath $hostsPath -Value $next -Encoding ASCII
Flush-DnsCache
Write-Host "Removed MLBB Co-Pilot local DNS hostnames."
