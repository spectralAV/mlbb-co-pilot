param(
  [Parameter(Mandatory = $true)]
  [string]$Video,
  [string]$Output = "",
  [string]$Name = "",
  [int]$Stride = 1,
  [int]$MaxFrames = 0,
  [double]$StartSeconds = 0,
  [double]$EndSeconds = -1,
  [ValidateSet("jpg", "png")]
  [string]$Format = "jpg",
  [int]$JpegQuality = 94,
  [ValidateSet("none", "train", "val")]
  [string]$DatasetSplit = "none",
  [switch]$Overwrite
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$python = Join-Path $root "data\cv\.venv\Scripts\python.exe"
if (-not (Test-Path $python)) {
  $python = "python"
}

$args = @(
  (Join-Path $root "backend\tools\extractVideoFrames.py"),
  "--project-root", $root,
  "--video", $Video,
  "--stride", "$Stride",
  "--format", $Format,
  "--jpeg-quality", "$JpegQuality",
  "--dataset-split", $DatasetSplit,
  "--start-seconds", "$StartSeconds"
)

if ($Output) {
  $args += @("--output", $Output)
}
if ($Name) {
  $args += @("--name", $Name)
}
if ($MaxFrames -gt 0) {
  $args += @("--max-frames", "$MaxFrames")
}
if ($EndSeconds -ge 0) {
  $args += @("--end-seconds", "$EndSeconds")
}
if ($Overwrite) {
  $args += "--overwrite"
}

& $python @args
exit $LASTEXITCODE
