$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root

Write-Host ""
Write-Host "Starting MLBB Co-Pilot..." -ForegroundColor Cyan
Write-Host "Backend:  http://localhost:8787" -ForegroundColor Green
Write-Host "Frontend: http://localhost:5173" -ForegroundColor Green
$localDnsHost = "mlbb.local"
if ($env:LOCAL_DNS_HOSTNAMES) {
  $localDnsHost = ($env:LOCAL_DNS_HOSTNAMES -split "," | Select-Object -First 1).Trim()
}
Write-Host "Local DNS: http://$($localDnsHost):5173" -ForegroundColor Green
Write-Host "Setup DNS: npm run local-dns:install (run PowerShell as Administrator)" -ForegroundColor DarkGray
Write-Host ""

npm run dev
