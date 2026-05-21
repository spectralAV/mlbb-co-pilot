$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root

Write-Host ""
Write-Host "Starting MLBB Co-Pilot..." -ForegroundColor Cyan
Write-Host "Backend:  http://localhost:8787" -ForegroundColor Green
Write-Host "Frontend: http://localhost:5173" -ForegroundColor Green
Write-Host ""

npm run dev
