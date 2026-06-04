# Video CV Review

Batch computer-vision review for extracted gameplay footage. Use this after `npm run cv:video:extract` when you want a timeline of screen states, draft transitions, and optional YOLO detections — without running Live Capture.

## Workflow

1. Extract frames from a match video:

```powershell
npm run cv:video:extract -- -Video "C:\path\to\match.mp4" -Name "ranked-match-01"
```

This writes `data/cv/footage/ranked-match-01/manifest.json`, `frames.csv`, and `frames/`.

2. Run CV review over the footage manifest (footage must be a folder name under `data/cv/footage/`, not an arbitrary filesystem path):

```powershell
npm run cv:video:review -- -Footage "ranked-match-01"
```

Or with tighter sampling and YOLO (requires trained `data/cv/models/mlbb-detect.pt`):

```powershell
npm run cv:video:review -- -Footage "ranked-match-01" -Interval 2 -MaxFrames 90 -Yolo
```

3. Open the generated artifact under `data/cv/reviews/<review-id>/`:
   - `review.json` — full structured timeline
   - `review.md` — markdown summary
   - `review.html` — browser-friendly report

## API (backend running)

```http
GET  /api/cv/video/footage
GET  /api/cv/video/reviews
GET  /api/cv/video/reviews/:id
POST /api/cv/video/review
```

Example:

```powershell
Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:8787/api/cv/video/review" `
  -ContentType "application/json" `
  -Body '{"footage":"ranked-match-01","sampleIntervalSeconds":1,"maxFrames":120,"runYolo":false}'
```

## Frontend

CV Studio → **Batch Review** (`/cv-studio/batch-review`) lists extracted footage, runs reviews, and shows timeline segments with links to Draft Room and Game Analysis.

## Coach / analytics integration

| Capability | Phase 1 status |
| --- | --- |
| Screen-state timeline from region classifier | Included in review artifact |
| Draft enter/exit / live HUD markers | Included |
| Optional YOLO class summary per sampled frame | Included when `-Yolo` / `runYolo: true` |
| Live match-state replay via `ingestLiveVisionFrame` | Deferred (would overwrite live capture state) |
| Live reasoning / advisory coach replay | Deferred |
| Draft engine analysis on recognized heroes | Available manually via Draft Room after live ingest |

For post-production annotation and label correction, continue using CV Studio → **Video Review** (`/cv-studio/video`).

## Tests

Core sampling and timeline logic (no GPU):

```powershell
npm test -- ../tests/videoCvReview.test.ts
```

## Notes

- The CLI runs via `npx tsx` from `backend/` (same as unit tests). Plain `node tools/run-video-cv-review.mjs` fails on `.js` TypeScript import paths.
- Footage directories under `data/cv/footage/` are gitignored; keep exports locally.
- Review output is written to `data/cv/reviews/` (also gitignored by default).
- YOLO inference uses the local Ultralytics worker (DirectML on Windows). CI does not run GPU inference.
