# MLBB Co-Pilot v0.4.0

Semantic tactical intelligence system for Mobile Legends: Bang Bang.

This build merges the v0.2.0 tactical co-pilot app, BuildLab runtime fixes, single-terminal scripts, the official GMS runtime sync layer, safe module patch handling, and a small overlay state API.

## Install

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
