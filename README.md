# MLBB Co-Pilot v0.4.0

Semantic tactical intelligence system for Mobile Legends: Bang Bang.

It combines a local web app, Electron desktop shell, backend tactical engines, and computer-vision tooling to help with draft decisions, build choices, live match awareness, OBS overlays, and post-game/gameplay analysis.

At a high level, it includes:

*Draft intelligence: recommends picks, bans, counters, synergies, and role-aware hero choices.

*Build and item guidance: suggests builds and counter-items based on enemy heroes and match context.

*Live capture/CV pipeline: supports ADB, scrcpy, OBS bridge, screen classification, minimap markers, scoreboard/equipment detection, OCR hooks, and YOLO/Ultralytics model support.

*Tactical map/runtime tools: map zones, minimap projection, objective context, lane pressure, gank risk, and live reasoning.

*Stream/OBS tools: overlay pages and stream output panels for live coaching.

*Desktop packaging: Electron-based Windows package and GHCR container package.

*Data/runtime sync: local compiled runtime data, MLBB hero/item/emblem/talent metadata, and safe module update handling.

## Install

For a step-by-step setup guide, see [Installing MLBB Co-Pilot](docs/installing-mlbb-copilot.md).

```powershell
cd "C:\Users\rokas\Documents\MLBB CoPilot"
npm run install:all
```

## Start

```powershell
npm run dev
```

Frontend: http://localhost:5173

Backend health: http://localhost:8787/api/health

## Desktop App

Electron desktop mode is wired for a Windows-first local app shell and has packaging targets declared for Windows, macOS, and Linux.

Run the desktop app against the dev servers:

```powershell
npm run desktop:dev
```

Run the built desktop shell:

```powershell
npm run desktop
```

Create an unpacked desktop build for local QA:

```powershell
npm run desktop:pack
```

Create a platform installer/package:

```powershell
npm run desktop:dist
```

The Electron shell starts the compiled Fastify backend as a managed local process, waits for `/api/health`, and loads the built frontend from the backend origin. Browser dev mode remains available through `npm run dev`.

## Container Package

The web runtime can also be published as a GitHub Container Registry package:

```text
ghcr.io/spectralav/mlbb-co-pilot:latest
ghcr.io/spectralav/mlbb-co-pilot:0.4.0
ghcr.io/spectralav/mlbb-co-pilot:mobile-legends-v0.4.0
```

Run it locally:

```powershell
docker run --rm -p 8787:8787 ghcr.io/spectralav/mlbb-co-pilot:latest
```

Then open:

```text
http://localhost:8787
```

Optional portless local DNS mode after setup:

```powershell
npm run dev:local
```

Frontend: http://mlbb.local

Backend health: http://api.mlbb.local/api/health

OBS output: http://obs.mlbb.local/mlbb-live-output

## Local DNS

MLBB Co-Pilot can run behind friendly local hostnames for browser and OBS sources:

```text
http://mlbb.local
http://api.mlbb.local/api/health
http://obs.mlbb.local/mlbb-live-output
```

Install the Windows hosts-file entries from an elevated PowerShell:

```powershell
npm run local-dns:install
```

Check or remove them:

```powershell
npm run local-dns:status
npm run local-dns:remove
```

Run the portless proxy together with the dev servers from an elevated PowerShell:

```powershell
npm run dev:local
```

The proxy listens on `127.0.0.1:80` and forwards frontend traffic to `127.0.0.1:5173`, API and app WebSocket traffic to `127.0.0.1:8787`, and Vite HMR WebSocket traffic to the frontend dev server. If port `80` is already taken, set `LOCAL_PROXY_PORT`, but URLs without a port require the proxy to own port `80`.

Override the defaults with a comma-separated host list when needed:

```powershell
$env:LOCAL_DNS_HOSTNAMES="mlbb.local,api.mlbb.local,obs.mlbb.local"
npm run dev:local
```

Backend and frontend dev servers bind to `127.0.0.1` by default. For a deliberate LAN test session, set `HOST` and `FRONTEND_HOST` before starting the app.

## Build

```powershell
npm run build
```

Backend-only checks:

```powershell
cd backend
npm run typecheck
npm run build
```

Frontend-only build:

```powershell
cd frontend
npm run build
```

## CV Runtime

Ultralytics YOLO runs through the managed Python environment in `data/cv/.venv`.

```powershell
npm run cv:status
```

Bootstrap or refresh the local YOLO dataset:

```powershell
npm run cv:bootstrap
```

This rebuilds `data/cv/images` and `data/cv/labels` from reviewed screen frames, local CV Lab annotations, and the already-synced `data/adb-assets` HUD sprites. It does not bypass protection or decompile game code; third-party game assets remain governed by their own terms.

Extract all frames from recorded gameplay footage for CV review and training intake:

```powershell
npm run cv:video:extract -- -Video "C:\path\to\match.mp4" -Name "ranked-match-01"
```

By default this writes frames under `data/cv/footage/<name>/frames` with a manifest and CSV index, without adding them to the active YOLO dataset. Use `-DatasetSplit train` only when you deliberately want the extracted frames added as empty-label background negatives. Running `cv:prepare` rebuilds the active dataset, so footage exports should stay in `data/cv/footage` until frames are reviewed or intentionally copied into training.

The backend selects `ULTRALYTICS_DEVICE=auto` by default. Auto uses ONNX Runtime DirectML for Windows AMD/DirectX 12 GPUs when available, CUDA when the managed PyTorch runtime exposes an NVIDIA CUDA GPU, then falls back to CPU. This is the preferred live inference path on AMD Windows because the DirectML worker has lower warm-frame latency than the WSL ROCm/PyTorch path. You can override it before starting:

```powershell
$env:ULTRALYTICS_DEVICE="directml"
npm run dev
```

For AMD Windows inference, the worker exports `data/cv/models/mlbb-detect.pt` to `data/cv/models/mlbb-detect.onnx` and runs it with `onnxruntime-directml`. Training uses the Ultralytics PyTorch path. For NVIDIA GPU training/inference, install a CUDA-enabled PyTorch build into `data/cv/.venv` using the selector at https://pytorch.org/get-started/locally/.

The backend keeps a bounded vision reflection log at `data/cache/vision-reflections.json`. It records noteworthy live vision frames, low-confidence/unknown frames, YOLO publish rejections, and native inference failures without changing match-state decisions. Inspect it with:

```text
GET /api/vision/reflections
GET /api/vision/reflections?limit=25
```

Optional PaddleOCR support is available as a sidecar text reader for screen regions such as the top HUD, kill feed, scoreboard modal, draft header, and result banner. It is separate from YOLO: detection still comes from Ultralytics, while PaddleOCR only reads text from selected regions.

```text
GET  /api/vision/models/screen-ocr/status
POST /api/vision/models/screen-ocr/install
POST /api/vision/models/screen-ocr/infer
```

Screen OCR runs manually from CV Lab by default. To allow future live-capture OCR polling, start the backend with:

```powershell
$env:MLBB_ENABLE_SCREEN_OCR="1"
npm run dev
```

### WSL ROCm Runtime

For AMD ROCm training or Torch inference, use Ubuntu 24.04 in WSL. The WSL path uses AMD's ROCDXG bridge through `/dev/dxg`, not the Windows DirectML worker.

```powershell
npm run cv:wsl:bootstrap
npm run cv:wsl:status
```

The bootstrap script creates `$HOME/.mlbb-copilot/cv-rocm` in Ubuntu, installs ROCm/PyTorch dependencies, builds a user-local `librocdxg` when needed, and validates that PyTorch can see the AMD GPU through its CUDA-compatible API. WSL ROCm training is available, but it is experimental on Radeon 780M under WSL and can stress the Windows display driver.

Keep the backend on the default Windows runtime for live DirectML inference. Start the backend against WSL only when you specifically want PyTorch ROCm inference instead of DirectML:

```powershell
$env:ULTRALYTICS_RUNTIME="wsl"
$env:ULTRALYTICS_WSL_DISTRO="Ubuntu-24.04"
npm run dev
```

The default training command uses the conservative Windows CPU path:

```powershell
npm run cv:train
```

The ROCm training command must be launched explicitly. It uses reduced WSL pressure by default (`imgsz=640`, `batch=2`, `workers=0`, `amp=false`):

```powershell
npm run cv:train:rocm
```

Docker Desktop on Windows does not expose AMD ROCm through the normal `/dev/kfd` and `/dev/dri` Linux path. If a ROCm container is used from WSL, it must use the ROCDXG `/dev/dxg` flags and mount `libdxcore.so` plus `librocdxg.so`.

## Legal

Copyright 2026 SpectralAV.

This is an independent project and is not affiliated with, endorsed by, sponsored by, or approved by Moonton, ByteDance, or the Mobile Legends: Bang Bang rights holders.

Original project code is licensed under the Apache License, Version 2.0. Third-party packages, models, trademarks, game assets, screenshots, artwork, and extracted/cached data remain governed by their own license terms. See `LICENSE` and `NOTICE`.

## Data Sync

Open Settings > Data Sync, paste a fresh GMS authorization header value, and run the sync. The token is sent only for that request.

Do not hardcode GMS authorization tokens, commit them, print them in logs, or paste them into issue reports.

Useful runtime endpoints:

```text
POST /api/sync/official
GET  /api/runtime
GET  /api/runtime/heroes
GET  /api/runtime/status
```

## Module Updates

Open Settings > Module Updates to upload a patch ZIP. Patch manifests may be named `patch.json` or `patch-manifest.json`.

Patch safety rules:

- rejects path traversal
- writes only to allowed project folders
- creates a backup before applying files
- does not run npm install automatically
- does not restart the app automatically

## Architecture Map

- `backend/src/server.ts`: Fastify app and route registration
- `backend/src/routes`: semantic, BuildLab, sync, runtime, updates, overlay routes
- `backend/src/routes/obsCoachRoutes.ts`: OBS coach state, region calibration, and prepared OBS endpoints
- `backend/src/providers/mlbb`: official GMS source clients
- `backend/src/runtime`: official runtime compiler and store
- `backend/src/engines`: draft, build, counter, synergy, ban, and semantic engines
- `frontend/src/pages`: tactical app screens and Settings tabs
- `frontend/src/pages/OverlayPreview.tsx`: 20:9 OBS browser-source overlay
- `frontend/src/pages/Calibration.tsx`: normalized region calibration UI
- `frontend/src/pages/GamePage.tsx`: active match cockpit for manual live coaching
- `frontend/src/pages/GameAnalysis.tsx`: local gameplay session review timeline
- `frontend/src/pages/GameOverlay.tsx`: compact OBS-safe game overlay
- `frontend/src/api/client.ts`: shared frontend API client
- `frontend/src/utils/assetResolver.ts`: hero, item, emblem, talent, and spell icon resolution
- `data/cache`: local cache and compiled runtime data
- `data/obs`: OBS source config and normalized screen regions

## OBS Coach Prep

Useful pages:

```text
http://localhost:5173/overlay
http://localhost:5173/game
http://localhost:5173/analysis
http://localhost:5173/game-overlay
http://localhost:5173/overlay-preview
http://localhost:5173/calibration
```

OBS capture is prepared but not connected to a live image reader in this TypeScript build. Region calibration data is stored in `data/obs/screen_regions.json`.
