# Draft CV verification checklist

Primary capture: **2856×1280** (20:9 phone) via **ADB** Live Capture.

## Before a live draft

1. `npm run cv:analyze` — train draft slot IoU ≥ 0.85, `roboflowCameraObjectiveFrames` = 0.
2. `npm run cv:wsl:train` then `npm run cv:export:onnx` — fresh `data/cv/models/mlbb-detect.pt` + ONNX.
3. Settings → **Index Draft Assets** + **Index CV Surfaces** (ADB asset banks for matchers).

## Offline (no lobby)

```powershell
npm run cv:verify:draft-offline
npm run cv:verify:draft-offline:ci   # geometry + unit tests only (Ubuntu CI)
```

Uses `data/cache/last-adb-frame.png` (save once from Live Capture on draft).

Slot geometry diagnostics on a cached PNG:

```powershell
node tools/analyze-capture-frame.mjs data/cache/last-adb-frame.png --with-draft-slots
```

Setup surfaces draft ADB assets, banner model, and UI layout graph readiness.

**Automated checks (no lobby):**
- YOLO ban/pick slot boxes on cached frame (`geometryReady: true` when slots detected ≥ 0.45)
- `node tools/replay-draft-scenarios.mjs` — lifecycle stabilizer
- Draft unit tests (`draftLifecycle`, `draftStabilizer`, `draftYoloSlots`)

Matcher scores against the **full reference roster** only apply when the cache frame is a **finalized** draft; a mid-ban screenshot will show 0/20 hero accepts even when YOLO geometry is correct.

## Draft Room Approve / Deny (human feedback)

While capture is running, **Draft Room** shows **Approve** and **Deny** when recognition confidence is stable.

| Action | Effect |
|--------|--------|
| **Approve** | Locks the current roster fingerprint in `data/cache/draft-ground-truth.json` and stops UI churn for the same draft state. Re-entering the same roster later uses a fast manual ingest path. |
| **Deny** | Edit slots in Draft Room, **Submit correction** → manual facts replace CV; wrong CV fingerprint is blocklisted; last ADB frame is saved as a CV Lab sample (`draft-room-deny`). Use **Open in CV Studio** to refine YOLO boxes, then run a quick correction train from CV Studio. |

Session approval clears on `draft_cleared` / new draft screen. Persistent approved profiles survive app restarts (LRU, max 20).

## Live draft (one full cycle)

| Check | Pass criteria |
|-------|----------------|
| Screen | Live Capture shows stable `draft`, not flickering `unknown` |
| YOLO geometry | Slot diagnostics show `geometrySource: "yolo"` on most slots (not only `default`) |
| Ally bans | Match ground truth (e.g. includes **Gloo** when banned) |
| Picks | Ally/enemy names match after stabilizer (3 contradictions to unlock a high-confidence lock) |
| Cache | `data/cache/last-adb-frame.png` updates; Draft Simulator shows reference frame |
| Regression | `npm test`, `node tools/replay-draft-scenarios.mjs` |

## Ground-truth reference roster

- Ally bans: X.Borg, Saber, Gloo, Obsidia, Freya
- Enemy bans: Harley, Freya, Aamon, Angela, Sora
- Ally picks: Lolita, Alpha, Ixia, Masha, Kagura
- Enemy picks: Florin, Miya, Joy, Gord, Silvanna

## Adding 20:9 training labels

1. Capture draft frames on phone → saved under `data/cache/` (or CV Lab).
2. `npm run cv:prepare` — imports `data/cache/*` phone_20_9 frames with auto slot rails into `data/cv/annotations/train/`.
3. Refine boxes in CV Lab if needed → `cv:prepare` + `cv:wsl:train` again.

Dataset already includes **300+** native 2856×1280 train frames from Roboflow/manifest; cache import adds device-specific seeds.
