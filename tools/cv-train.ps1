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

function Test-WindowsCudaTraining {
  param([string]$Python)
  $probe = @'
import json
info = dict(cuda=False)
try:
    import torch
    info['cuda'] = bool(torch.cuda.is_available() and torch.cuda.device_count() > 0)
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
    return [bool]$status.cuda
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
  if (@("directml", "dml", "amd", "amd-gpu") -contains $normalizedDevice) {
    throw "PyTorch DirectML is installed, but Ultralytics training is not supported on DirectML. Use CUDA or WSL ROCm."
  }
  Start-WindowsTraining
}
if (@("rocm", "hip", "wsl", "wsl-rocm") -contains $normalizedDevice) {
  Start-WslTraining
}

if (Test-WindowsCudaTraining -Python $windowsPython) {
  Start-WindowsTraining
}

Start-WslTraining
