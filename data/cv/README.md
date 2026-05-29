# MLBB YOLO Dataset

This dataset is for local Ultralytics object detection. It locates visual facts; exact hero, spell, and item identity remains a second-stage comparison against extracted official assets.

## Initial Labels

`minimap_panel`, `draft_screen`, `equipment_scoreboard`, `attributes_scoreboard`, `ally_pick_slot`, `enemy_pick_slot`, `ally_ban_slot`, `enemy_ban_slot`, `lane_marker`, `battle_spell_marker`, `ally_hero_marker`, `enemy_hero_marker`, `turtle`, `lord`, `ally_turret`, `enemy_turret`.

For minimap training, label only visible information. Hidden enemies are not present facts; they become last-seen state in the reasoning layer.

## Layout

Place annotated frames in `images/train` and `images/val`, and YOLO-format annotation files with matching base names in `labels/train` and `labels/val`.

Each label line is:

```text
class_id center_x center_y width height
```

All coordinates are normalized from `0` to `1`.

## Commands

From the project root after the managed runtime is installed:

```powershell
npm run cv:prepare
npm run cv:status
npm run cv:train
```

Extract every frame from a gameplay video into a reviewable footage workspace:

```powershell
npm run cv:video:extract -- -Video "C:\path\to\match.mp4" -Name "ranked-match-01"
```

The extractor writes frames to `data/cv/footage/<name>/frames`, plus `manifest.json` and `frames.csv`. It does not add frames to active YOLO training by default because unlabeled gameplay frames should be reviewed and labelled first. To intentionally add extracted frames as background-negative training examples, pass `-DatasetSplit train`; this creates matching empty YOLO label files. Running `cv:prepare` rebuilds the active dataset, so keep source footage exports under `data/cv/footage` and only copy reviewed/intentional frames into `images/train` or `images/val`.

`cv:train` uses the conservative Windows CPU training path. `cv:train:rocm` is available after `npm run cv:wsl:bootstrap`, but it is experimental on Radeon 780M under WSL and uses reduced pressure by default (`imgsz=640`, `batch=2`, `workers=0`, `amp=false`). Live inference remains on the Windows DirectML worker by default because it has lower warm-frame latency for this model.

Training writes the selected model to `data/cv/models/mlbb-detect.pt`. The app uses model detections only when that file exists and detections clear the confidence gate.

Training and native inference use unmirrored fixed-layout frames. Horizontal/vertical flips and mosaic are disabled because draft side ownership is semantic (`ally` and `enemy` cannot be swapped by augmentation), and `960` pixel inference preserves tiny lane/spell badge detail.

`cv:prepare` builds the detection set from human-reviewed Legend and Mythic capture frames, extracts additional spaced frames from stable periods, and adds the recorded equipment/attributes modal fixtures. It labels draft screen/slot surfaces, live minimap panel, finalized-draft lane and battle-spell badge locations, and scoreboard modal bodies; loading frames serve as negative examples.

Draft badge augmentation uses extracted official `Atlas_ChooseLane02_add` and `Atlas_SkillIcon` sprites composited into real finalized draft geometry. Ultralytics locates a visible lane or spell badge; the existing official-reference matcher determines which lane or spell it is. Hero portrait/icon identities, minimap unit markers, objectives, and turrets still require separately verified real-frame object labels before they enter YOLO training.

The local CV Lab stores hand-labelled frames under `data/cv/annotations` and syncs them into the active dataset. New classes are available for `turtle_respawn_timer`, `lord_respawn_timer`, `enemy_respawn_timer`, `ally_respawn_timer`, `minimap_objective_timer`, and `score_counter`. Detection locates these number-bearing regions; a dedicated OCR/digit reader and temporal validation layer must read and stabilize their values.

PaddleOCR is optional and lives outside the YOLO detector. Timer OCR reads manually labelled timer crops, and screen OCR reads calibrated UI regions from a captured frame for text such as match time, score, kill feed, draft header, or result banners. Keep live OCR disabled unless needed; use CV Lab's manual Read Text action first because OCR is heavier than detection.

## Result Screen Dataset

Post-match result screens use a separate YOLO dataset under `data/cv/result-screens` so hero/result-card training does not pollute the live gameplay detector. The importer is built for the MIT-licensed `R-N/ml_yolo_dataset` repository.

```powershell
npm run cv:result:metadata
npm run cv:result:import:sample
npm run cv:result:status
npm run cv:result:train
```

`cv:result:metadata` creates `dataset.yaml`, `classes.json`, and a manifest without downloading the full image set. `cv:result:import:sample` downloads a shuffled 500/150 train/validation subset for a quick local experiment. `cv:result:import:all` downloads the full roughly 900 MB source dataset. The imported classes cover result state, kills, duration, battle id, medals, AFK, and hero portraits up to Arlott; newer heroes need extra labels before this model can reliably read current result screens.
