#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="${1:-$(pwd)}"
VENV="${ULTRALYTICS_WSL_VENV:-${HOME}/.mlbb-copilot/cv-rocm}"
WORK_ROOT="${ULTRALYTICS_WSL_WORK_ROOT:-${HOME}/.mlbb-copilot}"
ROCDXG_PREFIX="${ULTRALYTICS_WSL_ROCDXG_PREFIX:-${WORK_ROOT}/rocdxg}"
ROCDXG_PATCH_RYZEN_780M_DEVICE_ID="${ROCDXG_PATCH_RYZEN_780M_DEVICE_ID:-1}"
ROCM_VERSION="${ROCM_VERSION:-7.2.3}"
PYTORCH_ROCM_INDEX="${PYTORCH_ROCM_INDEX:-https://download.pytorch.org/whl/nightly/rocm7.2}"
AMDGPU_INSTALL_DEB="${AMDGPU_INSTALL_DEB:-https://repo.radeon.com/amdgpu-install/7.2.3/ubuntu/noble/amdgpu-install_7.2.3.70203-1_all.deb}"

export DEBIAN_FRONTEND=noninteractive
SUDO=""
CAN_INSTALL_SYSTEM_PACKAGES=1
if [ "$(id -u)" != "0" ]; then
  if command -v sudo >/dev/null 2>&1 && sudo -n true >/dev/null 2>&1; then
    SUDO="sudo"
  else
    CAN_INSTALL_SYSTEM_PACKAGES=0
  fi
fi

echo "MLBB Co-Pilot WSL ROCm bootstrap"
echo "Project: ${PROJECT_ROOT}"
echo "Venv:    ${VENV}"
echo "ROCm:    ${ROCM_VERSION}"

if [ ! -e /dev/dxg ]; then
  echo "warning: /dev/dxg is missing. ROCm-on-WSL needs the Windows GPU bridge before PyTorch can see the AMD GPU." >&2
fi

if [ "${CAN_INSTALL_SYSTEM_PACKAGES}" = "1" ]; then
  ${SUDO} apt-get update
  ${SUDO} apt-get install -y \
    ca-certificates \
    cmake \
    curl \
    g++ \
    gcc \
    git \
    libglib2.0-0 \
    libgl1 \
    libjpeg-dev \
    make \
    python3-dev \
    python3-pip \
    python3-setuptools \
    python3-venv \
    python3-wheel \
    wget
else
  echo "warning: passwordless sudo is unavailable; using existing WSL system packages." >&2
  missing=()
  for command_name in cmake curl g++ gcc git make python3 wget; do
    if ! command -v "${command_name}" >/dev/null 2>&1; then
      missing+=("${command_name}")
    fi
  done
  if [ "${#missing[@]}" -gt 0 ]; then
    echo "error: missing required WSL packages: ${missing[*]}. Re-run bootstrap from a root shell or enable sudo for package installation." >&2
    exit 1
  fi
fi

if [ "${CAN_INSTALL_SYSTEM_PACKAGES}" = "1" ] && ! dpkg -s amdgpu-install >/dev/null 2>&1; then
  wget -O /tmp/amdgpu-install.deb "${AMDGPU_INSTALL_DEB}"
  ${SUDO} apt-get install -y /tmp/amdgpu-install.deb
  ${SUDO} apt-get update
fi

if [ "${CAN_INSTALL_SYSTEM_PACKAGES}" = "1" ] && { ! command -v rocminfo >/dev/null 2>&1 || [ ! -d /opt/rocm ]; }; then
  ${SUDO} apt-get install -y rocm rocminfo
fi
if ! command -v rocminfo >/dev/null 2>&1 || [ ! -d /opt/rocm ]; then
  echo "error: ROCm is not installed in WSL. Re-run bootstrap from a root shell or install rocm and rocminfo first." >&2
  exit 1
fi

if [ "${ROCDXG_FORCE_BUILD:-0}" = "1" ] || [ "${ROCDXG_PATCH_RYZEN_780M_DEVICE_ID}" = "1" ] || [ ! -f /opt/rocm/lib/librocdxg.so ]; then
  if [ "${CAN_INSTALL_SYSTEM_PACKAGES}" != "1" ]; then
    echo "warning: /opt/rocm/lib/librocdxg.so is missing; building a user-local ROCDXG library." >&2
  fi
  WIN_SDK="${WIN_SDK:-}"
  if [ -z "${WIN_SDK}" ]; then
    WIN_SDK="$(find "/mnt/c/Program Files (x86)/Windows Kits/10/Include" -maxdepth 2 -type d -name shared 2>/dev/null | sort -V | tail -n 1 || true)"
  fi
  if [ -z "${WIN_SDK}" ]; then
    echo "error: Windows SDK headers were not found under /mnt/c/Program Files (x86)/Windows Kits/10/Include." >&2
    exit 1
  fi

  mkdir -p "${WORK_ROOT}"
  if [ ! -d "${WORK_ROOT}/librocdxg-src/.git" ]; then
    git clone https://github.com/ROCm/librocdxg.git "${WORK_ROOT}/librocdxg-src"
  else
    git -C "${WORK_ROOT}/librocdxg-src" pull --ff-only
  fi
  if [ "${ROCDXG_PATCH_RYZEN_780M_DEVICE_ID}" = "1" ]; then
    UTILS_CPP="${WORK_ROOT}/librocdxg-src/shared/src/utils.cpp"
    if [ -f "${UTILS_CPP}" ] && ! grep -qi "0x15BF" "${UTILS_CPP}"; then
      echo "Patching ROCDXG GFXIP table for Radeon 780M device id 0x15BF."
      perl -0pi -e 's/\{ 0x1900, 11, 0, 3 \},/\{ 0x1900, 11, 0, 3 \},\n    { 0x15BF, 11, 0, 3 },/' "${UTILS_CPP}"
    fi
  fi
  cmake -S "${WORK_ROOT}/librocdxg-src" -B "${WORK_ROOT}/librocdxg-src/build" -DWIN_SDK="${WIN_SDK}" -DCMAKE_INSTALL_PREFIX="${ROCDXG_PREFIX}"
  cmake --build "${WORK_ROOT}/librocdxg-src/build" --parallel "$(nproc)"
  cmake --install "${WORK_ROOT}/librocdxg-src/build"
fi

python3 -m venv "${VENV}"
PIP_BASE_ARGS=(--retries "${PIP_RETRIES:-10}" --timeout "${PIP_TIMEOUT:-120}")
"${VENV}/bin/python" -m pip install "${PIP_BASE_ARGS[@]}" --upgrade pip wheel setuptools
PIP_ARGS=("${PIP_BASE_ARGS[@]}")
if "${VENV}/bin/python" -m pip install --help | grep -q -- "--resume-retries"; then
  PIP_ARGS+=(--resume-retries "${PIP_RESUME_RETRIES:-10}")
fi
"${VENV}/bin/python" -m pip install "${PIP_ARGS[@]}" --pre torch torchvision torchaudio --index-url "${PYTORCH_ROCM_INDEX}"
"${VENV}/bin/python" -m pip install "${PIP_ARGS[@]}" "ultralytics>=8.3,<9" "opencv-python-headless>=4.10,<5" "onnx>=1.16,<2"
if [ "${CAN_INSTALL_SYSTEM_PACKAGES}" = "1" ]; then
  ${SUDO} ln -sf "${VENV}/bin/python" /usr/local/bin/mlbb-copilot-cv-python
else
  echo "Using user-local CV Python: ${VENV}/bin/python"
fi

export HSA_ENABLE_DXG_DETECTION=1
export HSA_OVERRIDE_GFX_VERSION="${HSA_OVERRIDE_GFX_VERSION:-11.0.2}"
export ROCPROFILER_REGISTER_ENABLED=0
export LD_LIBRARY_PATH="${ROCDXG_PREFIX}/lib:/opt/rocm/lib:/usr/lib/wsl/lib:${LD_LIBRARY_PATH:-}"

"${VENV}/bin/python" - <<'PY'
import json
import torch

print(json.dumps({
    "torch": torch.__version__,
    "hip": getattr(torch.version, "hip", None),
    "cuda_api_available": torch.cuda.is_available(),
    "device_count": torch.cuda.device_count(),
    "devices": [torch.cuda.get_device_name(index) for index in range(torch.cuda.device_count())],
}))
if not torch.cuda.is_available():
    raise SystemExit("PyTorch ROCm installed, but no AMD GPU is visible through the CUDA-compatible torch API.")
PY

cd "${PROJECT_ROOT}"
"${VENV}/bin/python" backend/tools/ultralyticsVision.py status --project-root . --device auto
