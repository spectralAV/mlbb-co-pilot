param(
  [Parameter(Mandatory = $true)]
  [string]$Footage,
  [double]$Interval = 1,
  [int]$MaxFrames = 180,
  [switch]$Yolo,
  [double]$YoloConfidence = 0.55,
  [double]$MinConfidence = 0.45
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$scriptArgs = @(
  (Join-Path $root "tools\run-video-cv-review.mjs"),
  $Footage,
  "--interval", "$Interval",
  "--max-frames", "$MaxFrames",
  "--yolo-confidence", "$YoloConfidence",
  "--min-confidence", "$MinConfidence"
)
if ($Yolo) { $scriptArgs += "--yolo" }
Push-Location (Join-Path $root "backend")
try {
  & npx tsx @scriptArgs
  exit $LASTEXITCODE
} finally {
  Pop-Location
}
