<p align="center">
  <img src="assets/mlbb-copilot-icon.png" width="128" alt="MLBB Co-Pilot app icon">
</p>

<h1 align="center">MLBB Co-Pilot</h1>

<p align="center">
  <strong>Local tactical intelligence for Mobile Legends: Bang Bang draft, builds, live coaching, capture diagnostics, and CV-assisted match awareness.</strong>
</p>

<p align="center">
  <a href="https://github.com/spectralAV/mlbb-co-pilot/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/spectralAV/mlbb-co-pilot/actions/workflows/ci.yml/badge.svg"></a>
  <a href="https://github.com/spectralAV/mlbb-co-pilot/actions/workflows/publish-container.yml"><img alt="Container package" src="https://github.com/spectralAV/mlbb-co-pilot/actions/workflows/publish-container.yml/badge.svg"></a>
  <a href="https://github.com/spectralAV/mlbb-co-pilot/releases"><img alt="Release" src="https://img.shields.io/github/v/release/spectralAV/mlbb-co-pilot?include_prereleases&label=release"></a>
  <a href="LICENSE"><img alt="License" src="https://img.shields.io/github/license/spectralAV/mlbb-co-pilot"></a>
  <a href="https://streamelements.com/martianost/tip"><img alt="Tip on StreamElements" src="https://img.shields.io/badge/tip-StreamElements-9146FF"></a>
  <img alt="Node.js" src="https://img.shields.io/badge/node-22%20LTS-339933?logo=node.js&logoColor=white">
  <img alt="Electron" src="https://img.shields.io/badge/electron-desktop-47848F?logo=electron&logoColor=white">
  <img alt="TypeScript" src="https://img.shields.io/badge/typescript-app-3178C6?logo=typescript&logoColor=white">
</p>

<p align="center">
  <a href="#quickstart">Quickstart</a> |
  <a href="#capabilities">Capabilities</a> |
  <a href="#computer-vision">Computer Vision</a> |
  <a href="#documentation">Docs</a> |
  <a href="#roadmap">Roadmap</a> |
  <a href="#community-and-support">Support</a>
</p>

MLBB Co-Pilot is a Windows-first public alpha that combines a React tactical workspace, Fastify backend, Electron desktop shell, computer-vision tooling, map/runtime data, and OBS-ready overlays. It is designed to help players and creators reason about draft picks, counter picks, item builds, objective timing, lane pressure, gank risk, and live match context from local data.

The project is moving toward `1.0.0`. Current release: `v0.4.1-live-cockpit`.

## Status

| Area | Current state |
| --- | --- |
| Primary platform | Windows development and desktop packaging path |
| Desktop app | Electron shell with Windows NSIS target; macOS and Linux targets are configured but not yet platform-QA'd |
| Web app | Local React/Vite frontend and Fastify API |
| Container | GHCR package for the web runtime |
| Capture | ADB, scrcpy, OBS bridge, and first-run diagnostics in active development |
| CV | Ultralytics YOLO pipeline, ONNX Runtime DirectML path, WSL ROCm training path, OCR hooks, and dataset tooling |
| Release phase | Public alpha on the path to `1.0.0` |

## Quickstart

Clone and install all workspaces:

```powershell
git clone https://github.com/spectralAV/mlbb-co-pilot.git
cd mlbb-co-pilot
npm run install:all
```

Start the local web app:

```powershell
npm run dev
```

Open:

```text
Frontend: http://localhost:5173
Backend:  http://localhost:8787/api/health
```

Run the desktop app in development mode:

```powershell
npm run desktop:dev
```

Create an unpacked desktop build for local QA:

```powershell
npm run desktop:pack
```

For the full installer guide, see [Installing MLBB Co-Pilot](docs/installing-mlbb-copilot.md).

## Install Options

| Path | Command | Notes |
| --- | --- | --- |
| Source development | `npm run install:all` then `npm run dev` | Best for contributors and local testing |
| Electron desktop | `npm run desktop:dev`, `npm run desktop:pack`, or `npm run desktop:dist` | Windows is the primary supported package path today |
| Container runtime | `docker run --rm -p 8787:8787 ghcr.io/spectralav/mlbb-co-pilot:latest` | Serves the built web runtime through the backend |
| Friendly local URLs | `npm run local-dns:install` then `npm run dev:local` | Requires elevated PowerShell for hosts-file setup |

Container tags:

```text
ghcr.io/spectralav/mlbb-co-pilot:latest
ghcr.io/spectralav/mlbb-co-pilot:0.4.1-live-cockpit
ghcr.io/spectralav/mlbb-co-pilot:mobile-legends-v0.4.1-live-cockpit
```

## Capabilities

| Capability | What it does |
| --- | --- |
| Draft intelligence | Recommends picks, bans, counters, synergies, and role-aware hero choices |
| Build guidance | Suggests builds and counter-items from enemy heroes and match context |
| Live coaching | Tracks manual or captured match state for objective timing, lane pressure, and gank risk |
| Tactical map | Uses map zones, minimap projection, objective context, and live reasoning rules |
| Stream overlays | Provides OBS-friendly pages and stream output surfaces |
| First-run setup | Checks backend health, runtime data, capture tools, CV readiness, and optional integrations |
| Runtime sync | Compiles local MLBB hero, item, emblem, talent, and spell metadata |
| Module updates | Accepts local CV module ZIPs with manifest validation and backup safety |

## Computer Vision

MLBB Co-Pilot includes an experimental CV toolchain for local recognition workflows:

- Ultralytics YOLO detection pipeline for MLBB screen regions.
- ONNX Runtime DirectML inference path for Windows AMD/DirectX 12 GPUs.
- CUDA path when a CUDA-enabled PyTorch runtime is installed.
- CPU fallback for conservative local training and validation.
- Optional WSL ROCm path for AMD training experiments.
- OCR sidecar hooks for selected screen text regions.
- Roboflow draft and minimap exports can be staged as reviewed Ultralytics training enhancements.

Check local CV readiness:

```powershell
npm run cv:status
```

Prepare or refresh the local YOLO dataset:

```powershell
npm run cv:bootstrap
```

Train with the conservative Windows CPU path:

```powershell
npm run cv:train
```

Run the explicit WSL ROCm bootstrap and status checks:

```powershell
npm run cv:wsl:bootstrap
npm run cv:wsl:status
```

Install and inspect optional Roboflow Inference support:

```powershell
npm run cv:roboflow:inference:install
npm run cv:roboflow:inference:status
```

Convert a Roboflow YOLO export into the main Ultralytics training set:

```powershell
$env:ROBOFLOW_API_KEY = "<your key>"
npm run cv:draft:roboflow:enhance -- --clean --force
npm run cv:minimap:roboflow:enhance -- --clean --force
npm run cv:minimap:roboflow:enhance:gladi -- --clean --force
npm run cv:hud:roboflow:enhance:ocr -- --clean --force
npm run cv:camera:roboflow:enhance:objectives -- --clean --force
npm run cv:items:roboflow:enhance -- --clean --force
npm run cv:prepare
npm run cv:wsl:train
```

## Architecture

| Path | Purpose |
| --- | --- |
| `backend/src/server.ts` | Fastify API startup and route registration |
| `backend/src/routes` | Setup, sync, runtime, semantic, overlay, update, and integration routes |
| `backend/src/engines` | Draft, build, counter, synergy, ban, scoring, and live reasoning engines |
| `backend/src/vision` | Recognition, CV reflection, screen state, minimap, OCR, and model orchestration |
| `backend/tools` | Dataset prep, Ultralytics workers, Roboflow importers, OCR helpers, and video extraction |
| `frontend/src/pages` | Tactical app screens, setup flow, settings, CV Lab, map trainer, overlays, and dashboards |
| `frontend/src/components/game` | Live match cockpit, map controls, coaching feed, timers, and risk panels |
| `data` | Local runtime data, map data, OBS config, recognition samples, and CV datasets |
| `electron` | Desktop shell, preload bridge, backend readiness wait, and app launch logic |
| `map-runtime` | Compiled tactical map runtime files |

## Developer Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start backend and frontend dev servers |
| `npm run desktop:dev` | Start backend, frontend, and Electron together |
| `npm run build` | Build backend and frontend |
| `npm test` | Run the TypeScript test suite |
| `npm run desktop:pack` | Build an unpacked desktop app for QA |
| `npm run desktop:dist` | Build platform package targets |
| `npm run cv:status` | Inspect local CV runtime status |
| `npm run cv:roboflow:inference:status` | Inspect Roboflow Inference package/server readiness |
| `npm run cv:roboflow:training:status` | Inspect staged Roboflow training enhancements |
| `npm run cv:video:extract -- -Video "C:\path\to\match.mp4" -Name "ranked-match-01"` | Extract frames from gameplay footage for review |

## Documentation

| Document | Purpose |
| --- | --- |
| [Install Guide](docs/installing-mlbb-copilot.md) | Clean setup flow for source, desktop, CV, and local URLs |
| [Roadmap To 1.0.0](docs/roadmap-1.0.md) | Release path from `0.5.x` through stable `1.0.0` |
| [Known Limitations](docs/known-limitations.md) | Current alpha limitations and supported-platform notes |
| [Support Guide](docs/support.md) | What to include when opening issues |
| [Release Checklist](docs/release-checklist.md) | Pre-release and release validation steps |
| [Coach Reasoning Model](docs/coach-reasoning-model.md) | Notes on tactical reasoning and coaching flow |
| [CV Dataset Notes](data/cv/README.md) | Local dataset and CV runtime guidance |

## Roadmap

| Milestone | Goal |
| --- | --- |
| `0.5.x` | Stable installer, app icon and signing polish, first-run setup flow |
| `0.6.x` | Reliable phone capture path with ADB, scrcpy, and OBS diagnostics |
| `0.7.x` | Stronger CV dataset/model confidence and calibration UX |
| `0.8.x` | Polished draft, build, and live coaching workflows |
| `0.9.x` | Public beta, docs, bug fixes, and clean-machine install testing |
| `1.0.0` | Stable public release with clear supported platforms and known limitations |

## Community And Support

- Use [GitHub Issues](https://github.com/spectralAV/mlbb-co-pilot/issues/new/choose) for bugs, feature requests, documentation fixes, and capture/CV diagnostics.
- Support the project with an optional tip through [StreamElements](https://streamelements.com/martianost/tip).
- Read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request.
- Read [SECURITY.md](SECURITY.md) before reporting a vulnerability.
- Keep logs, screenshots, gameplay footage, auth headers, and third-party assets private unless you are sure they can be shared.

## Legal

Copyright 2026 SpectralAV.

MLBB Co-Pilot is an independent project and is not affiliated with, endorsed by, sponsored by, or approved by Moonton, ByteDance, or the Mobile Legends: Bang Bang rights holders.

Original project code is licensed under the Apache License, Version 2.0. Third-party packages, models, trademarks, game assets, screenshots, artwork, extracted data, cached data, and downloaded data remain governed by their own license terms. See [LICENSE](LICENSE) and [NOTICE](NOTICE).
