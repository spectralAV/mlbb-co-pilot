param(
  [ValidateSet("bootstrap", "status", "train", "export-onnx")]
  [string]$Action = "status",
  [int]$Epochs = 60,
  [int]$ImageSize = 640,
  [int]$Batch = 2,
  [int]$Workers = 2,
  [ValidateSet("true", "false")]
  [string]$Amp = "false",
  [string]$BaseModel = "yolo26n.pt",
  [string]$Device = "auto",
  [ValidateSet("full", "correction")]
  [string]$TrainingScope = "full",
  [int]$RecentLimit = 32,
  [int]$RepeatManual = 8
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$distro = if ($env:ULTRALYTICS_WSL_DISTRO) { $env:ULTRALYTICS_WSL_DISTRO } else { "Ubuntu-24.04" }
$wslHome = (& wsl -d $distro -- bash -lc 'printf %s "$HOME"').Trim()
$python = if ($env:ULTRALYTICS_WSL_PYTHON) { $env:ULTRALYTICS_WSL_PYTHON } else { "$wslHome/.mlbb-copilot/cv-rocm/bin/python" }
$rocdxgLibDir = if ($env:ULTRALYTICS_WSL_ROCDXG_LIB_DIR) { $env:ULTRALYTICS_WSL_ROCDXG_LIB_DIR } else { "$wslHome/.mlbb-copilot/rocdxg/lib" }
$gfxVersionOverride = if ($env:ULTRALYTICS_WSL_HSA_OVERRIDE_GFX_VERSION) { $env:ULTRALYTICS_WSL_HSA_OVERRIDE_GFX_VERSION } else { "11.0.2" }

$wslRoot = (& wsl -d $distro -- wslpath -a $root).Trim()
if (-not $wslRoot) {
  throw "Could not translate project root for WSL: $root"
}

if ($Action -eq "bootstrap") {
  $setup = Join-Path $root "backend\tools\setupWslRocmRuntime.sh"
  $wslSetup = (& wsl -d $distro -- wslpath -a $setup).Trim()
  & wsl -d $distro -- bash $wslSetup $wslRoot
  exit $LASTEXITCODE
}

$args = @(
  "-d", $distro,
  "--cd", $wslRoot,
  "--",
  "env",
  "HSA_ENABLE_DXG_DETECTION=1",
  "HSA_OVERRIDE_GFX_VERSION=$gfxVersionOverride",
  "ROCPROFILER_REGISTER_ENABLED=0",
  "LD_LIBRARY_PATH=$rocdxgLibDir`:/opt/rocm/lib:/usr/lib/wsl/lib",
  "ULTRALYTICS_DEVICE=$Device",
  $python,
  "backend/tools/ultralyticsVision.py",
  $Action,
  "--project-root", ".",
  "--device", $Device
)

if ($Action -eq "train") {
  $args += @(
    "--epochs", "$Epochs",
    "--image-size", "$ImageSize",
    "--batch", "$Batch",
    "--workers", "$Workers",
    "--amp", $Amp,
    "--base-model", $BaseModel,
    "--training-scope", $TrainingScope,
    "--recent-limit", "$RecentLimit",
    "--repeat-manual", "$RepeatManual"
  )
} elseif ($Action -eq "export-onnx") {
  $args += @("export-onnx")
}

& wsl @args
exit $LASTEXITCODE
