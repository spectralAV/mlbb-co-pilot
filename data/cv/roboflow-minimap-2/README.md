# Roboflow MLBB Minimap Dataset

This directory is an isolated YOLO workspace for experiments with the public Roboflow Universe project:

https://universe.roboflow.com/aung-khant-kyaw/mlbbminimap-2

The source project is small and appears focused on minimap hero-icon/object examples. Keep it separate from the production detector until class coverage and current-patch accuracy are checked against local captures.

Use an exported Roboflow YOLO zip or extracted folder:

```powershell
npm run cv:minimap:roboflow:import -- --source "C:\path\to\mlbbminimap-2.yolov8.zip" --clean --force
npm run cv:minimap:roboflow:status
npm run cv:minimap:roboflow:train
```

Run inference against a minimap or live HUD screenshot after training:

```powershell
npm run cv:minimap:roboflow:infer -- --image "C:\path\to\live-hud.jpg" --confidence 0.45
```
