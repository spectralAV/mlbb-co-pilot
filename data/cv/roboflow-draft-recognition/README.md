# Roboflow Draft Recognition Dataset

This directory is an isolated YOLO workspace for experiments with the public Roboflow Universe project:

https://universe.roboflow.com/mobile-legends-draft-pick/mobile-legends-draft-recognition

The importer writes `dataset.yaml`, `classes.json`, `manifest.json`, copied images, copied labels, runs, and model weights here. Those generated files are ignored by git so this experiment cannot accidentally alter the production `data/cv/mlbb-detection.yaml` detector.

Use an exported Roboflow YOLO zip or extracted folder:

```powershell
npm run cv:draft:roboflow:import -- --source "C:\path\to\mobile-legends-draft-recognition.yolov8.zip" --clean --force
npm run cv:draft:roboflow:status
npm run cv:draft:roboflow:train
```

Run inference against a draft screenshot after training:

```powershell
npm run cv:draft:roboflow:infer -- --image "C:\path\to\draft-screen.jpg" --confidence 0.45
```

Keep results experimental until class quality is checked against current Mobile Legends patches. The source dataset is small and may not cover newer heroes or every draft layout.
