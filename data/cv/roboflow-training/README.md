# Roboflow Training Enhancements

This folder stages Roboflow YOLO exports after they have been converted onto the main MLBB Ultralytics class set in `data/cv/mlbb-detection.yaml`.

Generated datasets are ignored by git. Import a reviewed Roboflow YOLO export here, then rebuild and train:

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

Use `draft-slots` for draft hero-recognition datasets. It snaps source hero boxes onto the app's draft slot classes and adds a full-frame `draft_screen` label.

Use `minimap-markers` for minimap hero/object datasets. Unknown hero-name classes become `enemy_hero_marker` by default; pass `--default-minimap-side ally` only for ally-focused exports.

Use `hud-ocr` for live HUD OCR datasets. It maps timer, score, KDA, and gold boxes into OCR regions such as `match_timer`, `ally_kill_counter`, `enemy_kill_counter`, `personal_kda`, and `personal_gold_counter`.

Use `camera-objectives` for current-camera jungle/objective datasets. It maps red buff, blue buff, little wonder, turtle, lord, and jungle creature labels into the live detector.

Use `post-match-items` for post-match item datasets. It maps item-name boxes to `post_match_item_slot` while skipping hero portrait and empty-slot labels.
