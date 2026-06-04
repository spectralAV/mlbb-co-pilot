# MLBB Recognition Samples

This folder is for local screenshot samples used to train/verify UI recognition.

Image samples are ignored by Git because they can contain personal avatars, friend names, and account information.

## Unity Layout RE (offline)

MLBB draft UI uses **NGUI `Transform` widgets**, not `RectTransform`. After a full UI sync (`scope: ui` → `data/adb-assets/library/UI/android`), extract a layout graph:

```powershell
pip install UnityPy
npm run assets:layout:extract        # draft + hud + loading + lobby + scoreboard bundles
npm run assets:layout:extract:draft  # draft-only (faster)
```

Output: `data/adb-assets/ui-layout-graph.json` (gitignored with other adb assets). Taxonomy rules live in `backend/tools/mlbbUiTaxonomy.py` (derived from real asset names like `m_Button_Confirm`, `m_zlabel_wantpickhero`, `m_MonsterHPBar`).

Each node includes: `elementKind` (button, label, bar, icon, …), `semanticTags`, `copilotClassHint` (YOLO class), optional `normalizedRect`. Each bundle includes `screen` (`draft`, `live_hud`, `loading`, `lobby`, …) and `draftUiStates` (e.g. `pick_confirm_visible`, `enemy_pick_active`, `ban_in_progress`).

API:

- `GET /api/sync/adb-assets/layout` — summary (bundle/node counts)
- `GET /api/sync/adb-assets/layout/UI_ChooseHeroBP.unity3d` — one bundle’s nodes

Runtime draft geometry still comes from **YOLO + calibration** on live frames; the layout graph is for training seeds, simulator UI, and RE validation after patches.

## Current Region Map

These maps are sample geometry from one capture shape, not production truth. Convert useful regions into normalized layout profiles, validate dynamic anchors at runtime, and keep calibration/manual override as the fallback for devices whose UI placement differs.

`region-map-ranked-lobby-2856x1280.json` maps the Ranked lobby avatar banner and queue slot regions from a `2856x1280` capture.

`region-map-ranked-choose-lane-2856x1280.json` maps the Ranked Choose Lane overlay. That screen is different from the lobby banner layout and includes six large cards:

- `exp_card`
- `jungle_card`
- `mid_card`
- `roam_card`
- `gold_card`
- `flex_card`

`flex_card` is a prematch shortcut, not a sixth role. It means the player accepts all five actual roles.

`region-map-ranked-lanes-confirmed-2856x1280.json` maps the ranked prematch lobby after lane preferences are confirmed. In that state, accepted lanes appear as compact icons on the player banner, for example two icons for `mid,roam`.

## Minimap References

Treat the MLBB minimap as two recognition layers:

- base minimap layout: the clean map without hero/objective/placeholders
- marker layer: the same map with role placeholders, hero dots, objectives, camps, turrets, and other runtime markers

Do not use these references as a reason to repaint the app UI yet. They are source geometry for future minimap calibration, segmentation, and marker recognition.

## Gameplay Sample Set

`gameplay-analysis-20260522.json` indexes a 36-screenshot set copied from live gameplay and draft captures. The raw PNGs live under `raw/20260522-gameplay-analysis/` and are intentionally ignored by Git.

This set adds coverage for:

- ranked lobby, ban, pick, and match-start prep states
- loading screen hero cards, spells, and loading percentages
- live HUD states, including death replay, objective calls, kill banners, and teamfights
- equipment and attributes scoreboard modals
- item shop recommendation and build-path panels

Use this set to build a first-pass screen-state classifier before attempting OCR or deeper recognition. The `2856x1280` region scale applies only to these source maps; production CV should adapt normalized ROIs through aspect-ratio profiles, dynamic UI anchors, saved calibration, and manual override.

## Draft Lifecycle Scenarios (no live lobby)

`draft-lifecycle-scenarios.json` replays short frame sequences through the same ingest path as Live Capture: missed ban slots, pre-lock pick swaps, lane changes, and cross-team duplicate bans.

- **CI:** `npx tsx --test ../tests/draftLifecycle.test.ts` (from `backend/`)
- **Running backend + Draft Room UI:** `node tools/replay-draft-scenarios.mjs` (optional `--id missed_ally_ban_slot`)

You do not need a custom 10-player lobby to validate roster logic. One real screenshot set (`last-adb-frame.png`, `tools/analyze-draft-slots.mjs`) plus these scripted scenarios covers most draft state bugs.

**Offline draft CV check (no lobby):**

```powershell
npm run cv:verify:draft-offline
```

Uses `data/cache/last-adb-frame.png` (from Live Capture) + `mlbb-detect.pt`. `cv:prepare` also imports phone cache frames into `data/cv/annotations/train/` with auto `phone_20_9` slot rails for CV Lab refinement.

**In-app:** Advanced nav → **Draft Simulator** (`/draft-simulator`) replays scenarios, shows pass/fail vs `expect`, and displays the last ADB reference frame.

**Draft Room feedback:** **Approve** caches a trusted roster for fast re-recognition; **Deny** saves a correction sample linked to CV Studio (`/cv-studio/frame?sample=...`) for label refinement and correction training.

**Server models (after Data Sync):**

- `GET /api/vision/models/draft-banners` — pick-rail banner signatures (`POST .../train` to rebuild)
- `GET /api/sync/adb-assets/layout` — Unity UI layout graph summary (run `npm run assets:layout:extract:draft` after Full UI download)

**CI:** `npm run cv:verify:draft-offline:ci` runs geometry-only checks without `mlbb-detect.pt`.

## ADB asset library (simulation inputs)

From **Settings → Data Sync** with the phone connected:

| Action | What it pulls |
|--------|----------------|
| Index Draft Assets | Draft-related Unity bundles + hero head textures |
| Index CV Surfaces | Draft, HUD, minimap, scoreboard, shop, lobby bundles |
| Download Full UI | Entire `UI/android` library from the game install (large; enables texture extraction) |

Extracted PNGs are served at `/api/sync/adb-assets/texture/...` and used to train `cv-draft-hero-model.json`. This is not a full re-skin of the MLBB draft UI in HTML yet—it feeds **recognition** and **offline analysis**, while roster logic is validated via scenarios above.

## Ranked Match Video Set

`ranked-video-analysis-20260525.json` compares the full Legend and Mythic recordings in `samples/`.

The videos establish two distinct draft asset surfaces:

- circular hero icons: top ban slots and the selectable hero grid
- portrait/card art: selected pick rails and the loading screen

Official recognition references now distinguish circular `head` icons from tall current portraits, so revamped base hero designs are sourced from Mobile Legends directly. The local Skin Gallery adds cosmetics portraits and compact face thumbnails from the community-maintained Mobile Legends Wiki. Live CV may use confirmed ban icons and confidence-gated compiled rail matches; in the Mythic fixture, the visible `Angelic Agent` card validates Lesley. It must not treat the center selection grid as picked facts or emit low-margin matches.

At draft finalize, selected rails can switch to skin designs while retaining the same hero identities. The Mythic fixture confirms the highlighted local slot as Gold Lane through its on-screen lane message; the Legend fixture confirms the expanded highlighted slot as EXP. Visible ally circular battle-spell badges are now separate confidence-gated draft facts.

## Battlefield Guide Sample Set

`../map/battlefield_mechanics_20260522.json` indexes a 38-screenshot set copied from the in-game battlefield guide. The raw PNGs live under `raw/20260522-battlefield-guide/` and are intentionally ignored by Git.

This set captures map mechanics that Map Trainer can use as semantic zone/objective context:

- terrain features: bushes, Cyclone Eye, and Magic Sentry
- common and elite jungle creeps, including spawn and respawn timers
- Turtle and Lord timing, rewards, and phase changes
- turret/base protection windows, sight ranges, damage, and defensive effects
- Mythical Honor+ turret and base adjustments

Use this set to connect drawn map zones to coaching behavior such as vision risk, rotation shortcuts, jungle buff timing, Turtle/Lord timers, and turret protection phases.

Important regions:

- `player_banner_full`
- `player_avatar_frame`
- `player_role_icon`
- `party_slot_0_leader_banner`
- `party_slot_1_card` through `party_slot_4_card`
- `party_slot_1_avatar_area` through `party_slot_4_avatar_area`
- `party_slot_1_lower_role_area` through `party_slot_4_lower_role_area`
- region groups: `party_cards`, `party_avatar_areas`, `party_role_icon_areas`
- `queue_slots_full`
- `queue_slot_1` through `queue_slot_4`
- `start_game_button`

## Needed Samples

Capture enough variation for:

- `solo`
- `duo`
- `trio`
- `five_man`

And role labels:

- `jungle`
- `exp`
- `gold`
- `mid`
- `roam`
- `unknown`

And dynamic icon states:

- `swap`
- `fill`
- `role_jungle`
- `role_exp`
- `role_gold`
- `role_mid`
- `role_roam`
- `unknown`

Prematch role selection rules:

- actual roles are `exp`, `jungle`, `mid`, `roam`, and `gold`
- `no_selection` means no lane is selected yet and the screen can show `Please select 2-5 lanes.`
- the Choose Lane screen can select up to five accepted roles before matchmaking
- `Flex Pro` means all five actual roles are accepted
- after matchmaking, the player receives one actual role
- if only `roam` is selected, matchmaking keeps the player roam-only

Suggested minimum per combination: 5 screenshots.

Party size matters because this screen can contain multiple player cards at once:

- slot 0 is your left-side leader banner
- in solo, only slot 0 can have your selected role
- slots 1-4 are central teammate cards/placeholders
- in duo, expect slot 0 + one filled teammate slot
- in trio, expect slot 0 + two filled teammate slots
- in five-man, expect all five slots populated

Solo prematch samples should record the selected role set:

```powershell
powershell -ExecutionPolicy Bypass -File .\tools\capture-mlbb-recognition-sample.ps1 -Screen ranked_choose_lane -Queue solo -Role unknown -IconState multi_role -SelectedRoles exp,jungle,mid
```

Roam-only and Flex Pro examples:

```powershell
powershell -ExecutionPolicy Bypass -File .\tools\capture-mlbb-recognition-sample.ps1 -Screen ranked_choose_lane -Queue solo -Role roam -IconState single_role -SelectedRoles roam
powershell -ExecutionPolicy Bypass -File .\tools\capture-mlbb-recognition-sample.ps1 -Screen ranked_choose_lane -Queue solo -Role unknown -IconState flex_all
```

Confirmed-lane lobby example:

```powershell
powershell -ExecutionPolicy Bypass -File .\tools\capture-mlbb-recognition-sample.ps1 -Screen ranked_lanes_confirmed -Queue solo -Role unknown -IconState multi_role -SelectedRoles mid,roam
```

## Vector Recognition

Build lane-icon vectors from the large Choose Lane icons. Clean confirmed-lane banner icons are also used as compact scale/frame exemplars by default:

```powershell
powershell -ExecutionPolicy Bypass -File .\tools\build-lane-icon-vector-templates.ps1
```

Use `-BigOnly` when you want to test only the large pre-confirmation icon vectors.

Then compare compact confirmed-lane banner icons against those canonical vectors:

```powershell
powershell -ExecutionPolicy Bypass -File .\tools\recognize-confirmed-lane-icons.ps1 -CropDir .\data\recognition-samples\crops\ranked_lanes_confirmed\solo\unknown\20260521-185115
```

The generated `lane-icon-vector-templates.json` file is ignored by Git because it contains machine-local sample paths.

## Workflow

1. Open the target MLBB screen on the device.
2. Run `tools/capture-mlbb-recognition-sample.ps1`.
3. Pass queue, role, and icon-state labels in the filename/manifest.
4. Review crops before using them for recognition.

Example:

```powershell
powershell -ExecutionPolicy Bypass -File .\tools\capture-mlbb-recognition-sample.ps1 -Screen ranked_lobby -Queue solo -Role unknown -IconState swap
```
