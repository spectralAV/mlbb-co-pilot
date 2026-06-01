param(
  [int]$Epochs = 60,
  [int]$ImageSize = 960,
  [int]$Batch = 4,
  [int]$Workers = 0,
  [ValidateSet("true", "false")]
  [string]$Amp = "false",
  [string]$BaseModel = "yolo26n.pt",
  [string]$Device = "auto"
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$windowsPython = Join-Path $root "data\cv\.venv\Scripts\python.exe"
if (-not (Test-Path $windowsPython)) {
  $windowsPython = "python"
}

function Test-WindowsTorchAccelerator {
  param([string]$Python)
  $probe = @'
import json
info = dict(cuda=False, directml=False)
try:
    import torch
    info['cuda'] = bool(torch.cuda.is_available() and torch.cuda.device_count() > 0)
except Exception:
    pass
try:
    import torch_directml
    is_available = getattr(torch_directml, 'is_available', None)
    info['directml'] = bool(is_available() if callable(is_available) else True)
except Exception:
    pass
print(json.dumps(info))
'@
  try {
    $output = & $Python -c $probe
    if ($LASTEXITCODE -ne 0) {
      return $false
    }
    $status = $output | ConvertFrom-Json
    return [bool]($status.cuda -or $status.directml)
  } catch {
    return $false
  }
}

function Start-WindowsTraining {
  $script = Join-Path $root "backend\tools\ultralyticsVision.py"
  & $windowsPython $script train --project-root $root --device $Device --epochs $Epochs --image-size $ImageSize --batch $Batch --workers $Workers --amp $Amp --base-model $BaseModel
  exit $LASTEXITCODE
}

function Start-WslTraining {
  $script = Join-Path $root "tools\cv-wsl.ps1"
  & powershell -NoProfile -ExecutionPolicy Bypass -File $script -Action train -Device $Device -Epochs $Epochs -ImageSize $ImageSize -Batch $Batch -Workers $Workers -Amp $Amp -BaseModel $BaseModel
  exit $LASTEXITCODE
}

$normalizedDevice = $Device.Trim().ToLowerInvariant()
if (@("cuda", "directml", "dml", "amd", "amd-gpu") -contains $normalizedDevice -or $normalizedDevice.StartsWith("cuda:")) {
  Start-WindowsTraining
}
if (@("rocm", "hip", "wsl", "wsl-rocm") -contains $normalizedDevice) {
  Start-WslTraining
}

if (Test-WindowsTorchAccelerator -Python $windowsPython) {
  Start-WindowsTraining
}

Start-WslTraining
