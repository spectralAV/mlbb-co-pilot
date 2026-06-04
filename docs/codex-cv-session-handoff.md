# CV & training session handoff (for Codex)

Generated: 2026-06-04. Summarizes Cursor agent work on MLBB Co-Pilot **computer vision**, **YOLO dataset prep**, and **runtime pipeline** so Codex can continue without chat history.

Related docs: `docs/cv-device-adaptation.md`, `data/cv/README.md`, conversation transcript `624fbe6b-a884-4298-a18c-bcef62b3f513` (agent-transcripts).

---

## User goals (arc)

1. **Fast + accurate** live CV on any capture aspect (Pixel 20:9, 16:9 HDMI, emulator).
2. **No per-device production models** — normalized ROIs + YOLO anchors + ADB asset matchers.
3. **No paid Roboflow at runtime** — local `cv:prepare` / WSL train only; Roboflow optional for staging imports.
4. Fix **draft** recognition (bans/picks, stabilizer, YOLO slot geometry) on **2856×1280**.
5. Understand **minimap** + **health bars** (health still not implemented).

---

## Architecture (do not change lightly)

**Three layers:**

| Layer | Role | Implementation |
|-------|------|----------------|
| Screen | `draft`, `live_hud`, `loading`, `scoreboard`, … | `captureRuntime.ts` heuristics + `trainedScreenStateModel` |
| Anchors (where) | Slots, minimap panel, timer ROIs, modals | YOLO `mlbb-detect.pt` (33 classes, `mlbb-detection.yaml`) |
| Specialists (what) | Hero, spell, item identity | ADB textures (`mlbbAdbAssets`), `draftIconDetector`, matchers; DINO optional |

**Rule:** YOLO does **not** classify hero IDs. Hero names come from template/signature match on crops inside YOLO boxes.

---

## What was implemented in this session

### 1. Dataset analysis & rebuild (`cv:prepare`)

**Problem found:** Active train set had ~**4991** images, dominated by Roboflow **`camera-objectives`** (~4005) — red/blue buff / jungle (wrong task for HUD anchor model). Draft Roboflow boxes were square icons, not slot rails. Only ~**282** frames at **2856×1280** (Pixel 20:9).

**New tooling:**

| File | Purpose |
|------|---------|
| `backend/tools/cvLayoutProfiles.py` | `phone_20_9`, `video_16_9`, `ultrawide_2_1` draft rails + minimap/scoreboard rects |
| `backend/tools/cvDatasetAlign.py` | Snap Roboflow draft boxes to rails; `roboflow_profile_allowed()` excludes `camera-objectives` |
| `backend/tools/analyzeCvDataset.py` | Writes `data/cv/runtime/dataset-analysis.json` |
| `npm run cv:analyze` | Runs analyzer |

**`prepareUltralyticsDataset.py` changes:**

- Profile-aware `draft_labels()` / `labels_for_sample()` via image size + `select_profile()`.
- `add_resolution_synthetic_draft_samples()` — 16× 1920×1080 draft frames + `video_16_9` slot labels.
- Roboflow import: filter by profile; `relabel_yolo_lines()` on draft-related imports.
- Post-prepare runs `analyzeCvDataset.py`.

**After rebuild (verified):**

- **Train:** 1101 images | **Val:** 105
- Draft mean slot IoU ~**0.94** (train)
- Origins: manifest/expanded/asset/synthetic + **936** aligned Roboflow (no camera-objectives)
- `data/cv/models/mlbb-detect.pt` exists on disk (~5.4 MB — retrain with `cv:wsl:train` recommended after dataset change)

### 2. Runtime: screen-gated YOLO + minimap merge

| File | Purpose |
|------|---------|
| `frontend/src/vision/yoloScreenGate.ts` | Skip YOLO on `loading`/`lobby`; class subsets per screen |
| `frontend/src/vision/minimapYolo.ts` | `minimapPanelRectFromYolo`, map/merge YOLO + color markers |
| `frontend/src/runtime/captureRuntime.ts` | Wired: gated infer, YOLO minimap crop, `mergeMinimapMarkers`, ingest `minimapObjects` between YOLO ticks |
| `tests/yoloScreenGate.test.ts` | Unit tests |
| `docs/cv-device-adaptation.md` | Note on screen-gated inference |

**`agentDebugLog`:** only sends in `import.meta.env.DEV` (`frontend/src/api/client.ts`).

### 3. Prior work (same arc, may be uncommitted)

From git status at session start — verify before assuming merged:

- `frontend/src/vision/draftYoloSlots.ts` — YOLO → draft slot rects
- `backend/src/vision/draftRecognition.ts`, `draftStabilizer.ts`
- `backend/tools/extractUnityUILayout.py`, `mlbbUiTaxonomy.py`
- `data/recognition-samples/draft-lifecycle-scenarios.json`
- Debug session `624fbe` in `draftIconDetector.ts`, `liveVisionState.ts` — **do not remove until user confirms on device**

---

## Training stack (reference)

```
Label (CV Lab) / Roboflow stage → data/cv/roboflow-training/
  → npm run cv:prepare     # destructive rebuild images/labels
  → npm run cv:analyze
  → npm run cv:wsl:train   # AMD: bootstrap first
  → data/cv/models/mlbb-detect.pt
```

- **Train:** WSL ROCm or Windows CUDA — **not** DirectML, not CPU.
- **Live infer:** Windows DirectML ONNX worker (`ultralyticsWorker.py`), ~1.2 s throttle.
- **Aug:** `fliplr=0`, `flipud=0`, `mosaic=0` (semantic ally/enemy sides).
- **imgsz:** 960 default in `tools/cv-train.ps1`.

Discord-friendly segments of runtime + training docs were written in chat; not duplicated here.

---

## Commands (maintainer)

```powershell
npm run cv:analyze
npm run cv:prepare
npm run cv:status
npm run cv:wsl:bootstrap   # once on AMD
npm run cv:wsl:train
npm run assets:layout:extract   # Unity UI graph (offline)
npm test   # includes cvDatasetAlign, draftYoloSlots, yoloScreenGate
```

---

## Gaps / next work (priority)

| P | Task | Notes |
|---|------|--------|
| P0 | **Train** on new dataset | `cv:wsl:train` after prepare |
| P0 | **Device verify** | Pixel draft: YOLO slots, Gloo ban, `geometrySource: yolo` |
| P1 | **More 20:9 labels** | CV Lab: `minimap_panel`, slots, markers — ~30–50 frames |
| P1 | **Minimap DINO loop** | `matchDinoIdentity(..., live_minimap)` per marker crop in `captureRuntime` |
| P2 | **Self HP bar** | Layout tag `health_bar` exists; no ROI/fill → `signals.lowHealth` |
| P2 | **Layout → synthetic YOLO labels** | `ui-layout-graph.json` seeds (not built) |
| P2 | **`draftUiStates`** from layout RE | Wire to `draftRecognition.phase` |
| P3 | Remove debug `624fbe` instrumentation | After user confirms |

---

## Key paths

```
data/cv/mlbb-detection.yaml
data/cv/images|labels/{train,val}          # gitignored
data/cv/runtime/bootstrap-dataset-manifest.json
data/cv/runtime/dataset-analysis.json
data/cv/roboflow-training/               # staged imports
data/adb-assets/textures/                # identity bank
backend/tools/prepareUltralyticsDataset.py
backend/tools/ultralyticsVision.py
frontend/src/runtime/captureRuntime.ts
frontend/src/vision/draftIconDetector.ts
frontend/src/vision/draftYoloSlots.ts
frontend/src/vision/yoloScreenGate.ts
frontend/src/vision/minimapYolo.ts
```

---

## Constraints for Codex

- **Do not commit** unless user asks.
- **Do not remove** debug session `624fbe` logs until user verifies on device.
- **Minimize scope** — match existing patterns in `prepareUltralyticsDataset.py` and `captureRuntime.ts`.
- **Roboflow:** optional dataset import only; exclude `camera-objectives` from main `mlbb-detect` training.
- **CI:** no GPU train on GitHub Actions.

---

## Ground truth (user reference draft)

Ally bans: X.Borg, Saber, Gloo, Obsidia, Freya. Enemy bans: Harley, Freya, Aamon, Angela, Sora. Ally picks: Lolita, Alpha, Ixia, Masha, Kagura. Enemy picks: Florin, Miya, Joy, Gord, Silvanna. Primary capture: **2856×1280** (20:9).

---

## One-line status

Dataset rebuilt and aligned (~1.1k train); runtime now screen-gates YOLO and merges color + YOLO minimap; **train + Pixel validation + more 20:9 labels** are the immediate follow-ups.
