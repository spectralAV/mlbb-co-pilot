$ErrorActionPreference = "Stop"
Write-Host "Installing MLBB Co-Pilot dependencies..." -ForegroundColor Cyan
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
  Write-Host "Node.js/npm is not installed. Install Node.js LTS first." -ForegroundColor Red
  exit 1
}
Push-Location $PSScriptRoot
npm install --prefix backend
npm install --prefix frontend
Write-Host "Done. Start backend and frontend in two terminals:" -ForegroundColor Green
Write-Host "cd $PSScriptRoot\backend; npm run dev"
Write-Host "cd $PSScriptRoot\frontend; npm run dev"
Pop-Location
