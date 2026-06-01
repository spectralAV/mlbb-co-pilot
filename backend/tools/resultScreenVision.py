import argparse
import importlib.util
import json
import shutil
import sys
from datetime import datetime, timezone
from pathlib import Path


def project_paths(project_root: Path):
    root = project_root / "data" / "cv" / "result-screens"
    return {
        "root": root,
        "dataset": root / "dataset.yaml",
        "weights": root / "models" / "mlbb-result-screen.pt",
        "runs": root / "runs",
        "runtime": root / "runtime",
    }


def count_files(directory: Path, patterns):
    return sum(1 for pattern in patterns for _ in directory.glob(pattern))


def load_names(dataset: Path):
    if not dataset.exists():
        return {}
    names = {}
    in_names = False
    for line in dataset.read_text(encoding="utf-8").splitlines():
        stripped = line.strip()
        if stripped == "names:":
            in_names = True
            continue
        if not in_names:
            continue
        if not stripped:
            continue
        if ":" not in stripped:
            continue
        key, value = stripped.split(":", 1)
        try:
            class_id = int(key.strip())
        except ValueError:
            continue
        label = value.strip()
        if (label.startswith('"') and label.endswith('"')) or (label.startswith("'") and label.endswith("'")):
            label = label[1:-1]
        names[class_id] = label
    return names


def status(project_root: Path):
    paths = project_paths(project_root)
    names = load_names(paths["dataset"])
    return {
        "engine": "ultralytics-result-screen",
        "packageAvailable": importlib.util.find_spec("ultralytics") is not None,
        "datasetAvailable": paths["dataset"].exists(),
        "modelAvailable": paths["weights"].exists(),
        "dataset": str(paths["dataset"]),
        "weights": str(paths["weights"]),
        "classes": {
            "count": len(names),
            "first": names.get(0),
            "last": names.get(max(names)) if names else None,
        },
        "training": {
            "images": count_files(paths["root"] / "images" / "train", ("*.png", "*.jpg", "*.jpeg", "*.webp")),
            "labels": count_files(paths["root"] / "labels" / "train", ("*.txt",)),
        },
        "validation": {
            "images": count_files(paths["root"] / "images" / "val", ("*.png", "*.jpg", "*.jpeg", "*.webp")),
            "labels": count_files(paths["root"] / "labels" / "val", ("*.txt",)),
        },
    }


def require_ultralytics():
    if importlib.util.find_spec("ultralytics") is None:
        raise RuntimeError("Ultralytics is not installed in the managed CV runtime.")
    from ultralytics import YOLO
    return YOLO


def parse_bool(value):
    if value is None:
        return None
    normalized = str(value).strip().lower()
    if normalized in ("1", "true", "yes", "on"):
        return True
    if normalized in ("0", "false", "no", "off"):
        return False
    raise ValueError(f"Expected a boolean value, got: {value}")


NO_CPU_TRAINING_MESSAGE = (
    "PyTorch CPU training is disabled. Configure CUDA, torch-directml, or WSL ROCm before starting "
    "Ultralytics training."
)


def resolve_training_device(device: str | None):
    requested = str(device or "auto").strip().lower()
    if requested == "cpu":
        raise RuntimeError(NO_CPU_TRAINING_MESSAGE)
    if requested and requested != "auto":
        return device
    try:
        import torch
    except Exception as error:
        raise RuntimeError(f"{NO_CPU_TRAINING_MESSAGE} PyTorch status failed: {error}") from error
    if torch.cuda.is_available() and torch.cuda.device_count() > 0:
        return "0"
    if getattr(getattr(torch, "backends", None), "mps", None) and torch.backends.mps.is_available():
        return "mps"
    raise RuntimeError(NO_CPU_TRAINING_MESSAGE)


def train(project_root: Path, base_model: str, epochs: int, image_size: int, device: str, batch: int | None, workers: int | None, amp: bool | None):
    paths = project_paths(project_root)
    current = status(project_root)
    if not current["datasetAvailable"]:
        raise RuntimeError("Run importResultScreenDataset.py before training the result-screen model.")
    if current["training"]["images"] == 0 or current["training"]["labels"] == 0:
        raise RuntimeError("Import labelled result-screen images before training.")
    selected_device = resolve_training_device(device)
    YOLO = require_ultralytics()
    paths["runs"].mkdir(parents=True, exist_ok=True)
    paths["runtime"].mkdir(parents=True, exist_ok=True)
    paths["weights"].parent.mkdir(parents=True, exist_ok=True)
    runtime_dataset = paths["runtime"] / "result-screen-training.yaml"
    runtime_dataset.write_text(
        paths["dataset"].read_text(encoding="utf-8").replace("path: .", f"path: '{paths['root'].as_posix()}'", 1),
        encoding="utf-8",
    )
    model = YOLO(base_model)
    options = {
        "data": str(runtime_dataset),
        "epochs": epochs,
        "imgsz": image_size,
        "project": str(paths["runs"]),
        "name": "mlbb-result-screen",
        "exist_ok": True,
        "fliplr": 0.0,
        "flipud": 0.0,
        "mosaic": 0.0,
        "translate": 0.02,
        "scale": 0.08,
        "device": selected_device,
    }
    if batch is not None:
        options["batch"] = batch
    if workers is not None:
        options["workers"] = workers
    if amp is not None:
        options["amp"] = amp
    run = model.train(**options)
    best = Path(run.save_dir) / "weights" / "best.pt"
    if not best.exists():
        raise RuntimeError("Ultralytics training finished without a best.pt model.")
    shutil.copy2(best, paths["weights"])
    return {
        **status(project_root),
        "trainedAt": datetime.now(timezone.utc).isoformat(),
        "baseModel": base_model,
        "epochs": epochs,
        "imageSize": image_size,
        "device": selected_device,
    }


def infer(project_root: Path, image: Path, confidence: float, image_size: int, device: str):
    paths = project_paths(project_root)
    if not paths["weights"].exists():
        return {**status(project_root), "ready": False, "detections": [], "reason": "No trained result-screen model found."}
    YOLO = require_ultralytics()
    model = YOLO(str(paths["weights"]))
    predictions = model.predict(source=str(image), conf=confidence, imgsz=image_size, verbose=False, device=device)
    detections = []
    for prediction in predictions:
        names = prediction.names
        height, width = prediction.orig_shape
        for box in prediction.boxes:
            class_id = int(box.cls[0].item())
            score = float(box.conf[0].item())
            left, top, right, bottom = [float(value) for value in box.xyxy[0].tolist()]
            detections.append({
                "classId": class_id,
                "className": names.get(class_id, str(class_id)),
                "confidence": round(score, 5),
                "bbox": [
                    round(left / width, 6),
                    round(top / height, 6),
                    round((right - left) / width, 6),
                    round((bottom - top) / height, 6),
                ],
                "center": [
                    round((left + right) / 2 / width, 6),
                    round((top + bottom) / 2 / height, 6),
                ],
                "source": "result-screen-yolo",
            })
    return {**status(project_root), "ready": True, "detections": detections}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=["status", "train", "infer"])
    parser.add_argument("--project-root", required=True)
    parser.add_argument("--image")
    parser.add_argument("--confidence", type=float, default=0.55)
    parser.add_argument("--base-model", default="yolo26n.pt")
    parser.add_argument("--epochs", type=int, default=60)
    parser.add_argument("--image-size", type=int, default=960)
    parser.add_argument("--device", default="auto")
    parser.add_argument("--batch", type=int, default=None)
    parser.add_argument("--workers", type=int, default=None)
    parser.add_argument("--amp", default=None)
    args = parser.parse_args()
    root = Path(args.project_root).resolve()
    try:
        if args.command == "status":
            result = status(root)
        elif args.command == "train":
            result = train(root, args.base_model, args.epochs, args.image_size, args.device, args.batch, args.workers, parse_bool(args.amp))
        else:
            if not args.image:
                raise RuntimeError("--image is required for inference.")
            result = infer(root, Path(args.image), args.confidence, args.image_size, args.device)
        print(json.dumps({"ok": True, "data": result}))
    except Exception as error:
        print(json.dumps({"ok": False, "error": str(error)}))
        sys.exit(1)


if __name__ == "__main__":
    main()
