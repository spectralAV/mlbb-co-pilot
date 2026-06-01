# MLBB YOLO Dataset

This dataset is for local Ultralytics object detection. It locates visual facts; exact hero, spell, and item identity remains a second-stage comparison against extracted official assets.

Production CV is device-adaptive, not device-specific. The model should learn stable MLBB UI surfaces, while runtime support for different phones, emulators, capture cards, and aspect ratios comes from normalized ROIs, dynamic UI anchors, aspect-ratio layout profiles, calibration fallback, confidence gates, and manual override. See `../../docs/cv-device-adaptation.md`.

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

Keep source annotations and saved runtime regions normalized. Pixel coordinates are temporary values for frame cropping, rendering overlays, and inference worker boundaries only.

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

`cv:train` is GPU-first: it uses Windows CUDA when available, then falls back to WSL ROCm. CPU PyTorch training is intentionally blocked. torch-directml is installed for DirectML device visibility, but YOLO training does not target DirectML because required loss ops are unsupported there. `cv:train:rocm` is available after `npm run cv:wsl:bootstrap` when you want to force the WSL path. Live inference remains on the Windows DirectML worker by default because it has lower warm-frame latency for this model.

Training writes the selected model to `data/cv/models/mlbb-detect.pt`. The app uses model detections only when that file exists and detections clear the confidence gate.

Training and native inference use unmirrored semantic-layout frames. Horizontal/vertical flips and mosaic are disabled because draft side ownership is semantic (`ally` and `enemy` cannot be swapped by augmentation), and `960` pixel inference preserves tiny lane/spell badge detail. This does not make one device resolution authoritative; runtime should adapt ROIs from anchors, aspect-ratio profiles, and saved calibration.

`cv:prepare` builds the detection set from human-reviewed Legend and Mythic capture frames, extracts additional spaced frames from stable periods, adds staged Roboflow training enhancements, and adds the recorded equipment/attributes modal fixtures. It labels draft screen/slot surfaces, live minimap panel, finalized-draft lane and battle-spell badge locations, and scoreboard modal bodies; loading frames serve as negative examples.

Draft badge augmentation uses extracted official `Atlas_ChooseLane02_add` and `Atlas_SkillIcon` sprites composited into real finalized draft geometry. Ultralytics locates a visible lane or spell badge; the existing official-reference matcher determines which lane or spell it is. Hero portrait/icon identities, minimap unit markers, objectives, and turrets still require separately verified real-frame object labels before they enter YOLO training.

The local CV Lab stores hand-labelled frames under `data/cv/annotations` and syncs them into the active dataset. OCR-region classes are available for `turtle_respawn_timer`, `lord_respawn_timer`, `enemy_respawn_timer`, `ally_respawn_timer`, `minimap_objective_timer`, `score_counter`, `match_timer`, `ally_kill_counter`, `enemy_kill_counter`, `personal_kda`, and `personal_gold_counter`. Detection locates these number-bearing regions; a dedicated OCR/digit reader and temporal validation layer must read and stabilize their values.

## Roboflow Training Enhancements

Roboflow datasets should strengthen the Ultralytics training data, not replace the app's live CV contract. The enhancement importer converts a Roboflow YOLO export onto the existing `mlbb-detection.yaml` label set and stages it under `data/cv/roboflow-training`. Running `cv:prepare` then copies those converted samples into the active training folders.

For draft recognition exports, convert hero-name boxes into draft slot labels:

```powershell
$env:ROBOFLOW_API_KEY = "<your key>"
npm run cv:draft:roboflow:enhance -- --clean --force
```

For minimap exports, convert hero/object labels into minimap marker/object labels:

```powershell
$env:ROBOFLOW_API_KEY = "<your key>"
npm run cv:minimap:roboflow:enhance -- --clean --force
npm run cv:minimap:roboflow:enhance:gladi -- --clean --force
```

For live HUD OCR, camera-view jungle objectives, and post-match item exports:

```powershell
$env:ROBOFLOW_API_KEY = "<your key>"
npm run cv:hud:roboflow:enhance:ocr -- --clean --force
npm run cv:camera:roboflow:enhance:objectives -- --clean --force
npm run cv:items:roboflow:enhance -- --clean --force
```

Then rebuild and train:

```powershell
npm run cv:prepare
npm run cv:wsl:train
```

Use `npm run cv:roboflow:training:status` to inspect staged converted data. The generic importer accepts either a local `--source` zip/folder or `--roboflow-workspace`, `--roboflow-project`, and `ROBOFLOW_API_KEY` for direct export downloads.

PaddleOCR is optional and lives outside the YOLO detector. Timer OCR reads manually labelled timer crops, and screen OCR reads calibrated UI regions from a captured frame for text such as match time, score, kill feed, draft header, or result banners. Keep live OCR disabled unless needed; use CV Lab's manual Read Text action first because OCR is heavier than detection.

## Roboflow Inference

Roboflow Inference is available as optional tooling for running a local Docker-backed Inference server and calling Roboflow Workflows or Universe models while keeping its Python dependency graph separate from the main CV/OCR runtime. Training enhancement uses reviewed YOLO exports; inference output should be reviewed before becoming training labels.

Install the Python CLI and SDK into the dedicated Roboflow runtime:

```powershell
npm run cv:roboflow:inference:install
```

Check package, Docker, API key, and local server readiness:

```powershell
npm run cv:roboflow:inference:status
npm run cv:roboflow:inference:docker
```

Start the local Inference server:

```powershell
npm run cv:roboflow:inference:start
```

The server listens on `http://localhost:9001` by default. Set `ROBOFLOW_API_KEY` before starting or calling Roboflow if you need private projects, fine-tuned models, Universe models, dataset export access, or hosted API features.

## Result Screen Dataset

Post-match result screens use a separate YOLO dataset under `data/cv/result-screens` so hero/result-card training does not pollute the live gameplay detector. The importer is built for the MIT-licensed `R-N/ml_yolo_dataset` repository.

```powershell
npm run cv:result:metadata
npm run cv:result:import:sample
npm run cv:result:status
npm run cv:result:train
```

`cv:result:metadata` creates `dataset.yaml`, `classes.json`, and a manifest without downloading the full image set. `cv:result:import:sample` downloads a shuffled 500/150 train/validation subset for a quick local experiment. `cv:result:import:all` downloads the full roughly 900 MB source dataset. The imported classes cover result state, kills, duration, battle id, medals, AFK, and hero portraits up to Arlott; newer heroes need extra labels before this model can reliably read current result screens.

## Roboflow Draft Recognition Dataset

The public Roboflow Universe `mobile-legends-draft-recognition` project can be imported as an isolated experiment under `data/cv/roboflow-draft-recognition`, or converted into the main training enhancement area with `cv:draft:roboflow:enhance`. Do not merge its source classes directly into `mlbb-detection.yaml`; the live detector intentionally locates draft slots while official asset matching determines exact hero identity.

Export the Roboflow project in YOLO format, then import the zip or extracted folder:

```powershell
npm run cv:draft:roboflow:import -- --source "C:\path\to\mobile-legends-draft-recognition.yolov8.zip" --clean --force
npm run cv:draft:roboflow:status
npm run cv:draft:roboflow:train
```

The importer accepts standard Roboflow YOLO layouts such as `train/images`, `valid/images`, and matching `labels` directories. It validates YOLO class and normalized box values, writes a local `dataset.yaml`, and leaves production CV data untouched.

To use the same export to improve the main Ultralytics detector, run:

```powershell
npm run cv:draft:roboflow:enhance -- --clean --force
```

## Roboflow Minimap Dataset

The public Roboflow Universe `mlbbminimap-2` project can also be imported under `data/cv/roboflow-minimap-2`, or converted into the main training enhancement area with `cv:minimap:roboflow:enhance`. The observed project is small and focused on minimap hero-icon examples, so review results against local live HUD captures.

```powershell
npm run cv:minimap:roboflow:import -- --source "C:\path\to\mlbbminimap-2.yolov8.zip" --clean --force
npm run cv:minimap:roboflow:status
npm run cv:minimap:roboflow:train
```

After training:

```powershell
npm run cv:minimap:roboflow:infer -- --image "C:\path\to\live-hud.jpg" --confidence 0.45
```

To use the same export to improve the main Ultralytics detector, run:

```powershell
npm run cv:minimap:roboflow:enhance -- --clean --force
```
