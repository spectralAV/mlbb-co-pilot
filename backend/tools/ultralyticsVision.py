import argparse
import importlib.util
import json
import os
import shutil
import sys
from datetime import datetime, timezone
from pathlib import Path


CLASSES = [
    "minimap_panel",
    "draft_screen",
    "equipment_scoreboard",
    "attributes_scoreboard",
    "ally_pick_slot",
    "enemy_pick_slot",
    "ally_ban_slot",
    "enemy_ban_slot",
    "lane_marker",
    "battle_spell_marker",
    "ally_hero_marker",
    "enemy_hero_marker",
    "turtle",
    "lord",
    "ally_turret",
    "enemy_turret",
    "turtle_respawn_timer",
    "lord_respawn_timer",
    "enemy_respawn_timer",
    "ally_respawn_timer",
    "minimap_objective_timer",
    "score_counter",
]


def project_paths(project_root: Path):
    cv_root = project_root / "data" / "cv"
    return {
        "root": cv_root,
        "dataset": cv_root / "mlbb-detection.yaml",
        "weights": cv_root / "models" / "mlbb-detect.pt",
        "onnx": cv_root / "models" / "mlbb-detect.onnx",
        "runs": cv_root / "runs",
        "runtime": cv_root / "runtime",
    }


def image_count(directory: Path):
    return sum(1 for ext in ("*.png", "*.jpg", "*.jpeg", "*.webp") for _ in directory.glob(ext))


def label_count(directory: Path):
    return sum(1 for _ in directory.glob("*.txt"))


def requested_device(device: str | None = None):
    requested = str(device or os.environ.get("ULTRALYTICS_DEVICE") or "auto").strip()
    return requested or "auto"


def torch_device_status(device: str | None = None):
    requested = requested_device(device)
    info = {
        "requested": requested,
        "selected": "cpu",
        "type": "cpu",
        "name": "CPU",
        "torchAvailable": False,
        "torchVersion": None,
        "cudaAvailable": False,
        "cudaVersion": None,
        "hipAvailable": False,
        "hipVersion": None,
        "cudaDeviceCount": 0,
        "cudaDevices": [],
        "warning": "",
    }
    try:
        import torch
    except Exception as error:
        info["warning"] = f"PyTorch is unavailable: {error}"
        return info

    info["torchAvailable"] = True
    info["torchVersion"] = getattr(torch, "__version__", None)
    info["cudaAvailable"] = bool(torch.cuda.is_available())
    info["cudaVersion"] = getattr(torch.version, "cuda", None)
    info["hipVersion"] = getattr(torch.version, "hip", None)
    info["hipAvailable"] = bool(info["cudaAvailable"] and info["hipVersion"])
    info["cudaDeviceCount"] = int(torch.cuda.device_count()) if hasattr(torch, "cuda") else 0
    cuda_devices = []
    for index in range(info["cudaDeviceCount"]):
        try:
            cuda_devices.append(torch.cuda.get_device_name(index))
        except Exception:
            cuda_devices.append(f"CUDA device {index}")
    info["cudaDevices"] = cuda_devices

    normalized = requested.lower()
    if normalized in ("", "auto"):
        if info["cudaAvailable"] and info["cudaDeviceCount"] > 0:
            info["selected"] = "0"
            info["type"] = "rocm" if info["hipAvailable"] else "cuda"
            info["name"] = cuda_devices[0] if cuda_devices else "CUDA device 0"
        elif getattr(getattr(torch, "backends", None), "mps", None) and torch.backends.mps.is_available():
            info["selected"] = "mps"
            info["type"] = "mps"
            info["name"] = "Apple MPS"
        elif info["hipVersion"]:
            info["warning"] = "ROCm/HIP is installed, but no compatible GPU device is visible to PyTorch."
        return info

    info["selected"] = "0" if normalized == "cuda" else requested
    if normalized == "cpu":
        info["type"] = "cpu"
        info["name"] = "CPU"
    elif normalized == "mps":
        info["type"] = "mps"
        info["name"] = "Apple MPS"
    elif normalized in ("rocm", "hip") or normalized == "cuda" or normalized.startswith("cuda") or normalized.replace(",", "").isdigit():
        info["type"] = "rocm" if info["hipAvailable"] or normalized in ("rocm", "hip") else "cuda"
        index_text = normalized.split(":", 1)[1] if normalized.startswith("cuda:") else normalized.split(",", 1)[0]
        try:
            index = int(index_text) if index_text and index_text not in ("cuda", "rocm", "hip") else 0
        except ValueError:
            index = 0
        info["name"] = cuda_devices[index] if 0 <= index < len(cuda_devices) else f"CUDA device {index}"
        if not info["cudaAvailable"]:
            accelerator = "ROCm/HIP" if normalized in ("rocm", "hip") else "CUDA"
            info["warning"] = f"{accelerator} was requested, but this PyTorch runtime does not expose a compatible GPU device."
    else:
        info["type"] = normalized
        info["name"] = requested
    return info


def onnxruntime_status():
    info = {
        "packageAvailable": False,
        "version": None,
        "providers": [],
        "directmlAvailable": False,
    }
    try:
        import onnxruntime as ort
    except Exception:
        return info
    providers = list(ort.get_available_providers())
    info["packageAvailable"] = True
    info["version"] = getattr(ort, "__version__", None)
    info["providers"] = providers
    info["directmlAvailable"] = "DmlExecutionProvider" in providers
    return info


def inference_backend_status(project_root: Path, device: str | None = None):
    requested = requested_device(device).lower()
    paths = project_paths(project_root)
    ort = onnxruntime_status()
    torch_status = torch_device_status(device)
    if requested in ("directml", "dml", "amd", "amd-gpu") or (requested == "auto" and ort["directmlAvailable"]):
        selected = "directml" if ort["directmlAvailable"] else "torch"
    else:
        selected = "torch"
    warning = ""
    if selected == "directml" and not paths["onnx"].exists():
        warning = "DirectML is available, but the ONNX export has not been created yet."
    if requested in ("directml", "dml", "amd", "amd-gpu") and not ort["directmlAvailable"]:
        warning = "DirectML was requested, but onnxruntime-directml does not expose DmlExecutionProvider."
    return {
        "requested": requested_device(device),
        "selected": selected,
        "onnxModelAvailable": paths["onnx"].exists(),
        "onnxModel": str(paths["onnx"]),
        "onnxRuntime": ort,
        "torch": torch_status,
        "warning": warning,
    }


def status(project_root: Path, device: str | None = None):
    paths = project_paths(project_root)
    package_available = importlib.util.find_spec("ultralytics") is not None
    return {
        "engine": "ultralytics",
        "packageAvailable": package_available,
        "modelAvailable": paths["weights"].exists(),
        "onnxModelAvailable": paths["onnx"].exists(),
        "weights": str(paths["weights"]),
        "onnxModel": str(paths["onnx"]),
        "dataset": str(paths["dataset"]),
        "classes": CLASSES,
        "training": {
            "images": image_count(paths["root"] / "images" / "train"),
            "labels": label_count(paths["root"] / "labels" / "train"),
        },
        "validation": {
            "images": image_count(paths["root"] / "images" / "val"),
            "labels": label_count(paths["root"] / "labels" / "val"),
        },
        "device": torch_device_status(device),
        "inferenceBackend": inference_backend_status(project_root, device),
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


def train(project_root: Path, base_model: str, epochs: int, image_size: int, device: str | None, batch: int | None, workers: int | None, amp: bool | None):
    paths = project_paths(project_root)
    current = status(project_root, device)
    if current["training"]["images"] == 0 or current["training"]["labels"] == 0:
        raise RuntimeError("Add labelled images and YOLO annotations before training.")
    YOLO = require_ultralytics()
    selected_device = current["device"]["selected"]
    paths["runs"].mkdir(parents=True, exist_ok=True)
    paths["runtime"].mkdir(parents=True, exist_ok=True)
    paths["weights"].parent.mkdir(parents=True, exist_ok=True)
    dataset = paths["runtime"] / "mlbb-training.yaml"
    dataset.write_text(
        paths["dataset"].read_text(encoding="utf-8").replace("path: .", f"path: '{paths['root'].as_posix()}'", 1),
        encoding="utf-8",
    )
    model = YOLO(base_model)
    train_options = {
        "data": str(dataset),
        "epochs": epochs,
        "imgsz": image_size,
        "project": str(paths["runs"]),
        "name": "mlbb-detection",
        "exist_ok": True,
        "fliplr": 0.0,
        "flipud": 0.0,
        "mosaic": 0.0,
        "translate": 0.03,
        "scale": 0.12,
        "device": selected_device,
    }
    if batch is not None:
        train_options["batch"] = batch
    if workers is not None:
        train_options["workers"] = workers
    if amp is not None:
        train_options["amp"] = amp
    run = model.train(**train_options)
    best = Path(run.save_dir) / "weights" / "best.pt"
    if not best.exists():
        raise RuntimeError("Ultralytics training finished without a best.pt model.")
    shutil.copy2(best, paths["weights"])
    if paths["onnx"].exists():
        paths["onnx"].unlink()
    return {
        **status(project_root, device),
        "trainedAt": datetime.now(timezone.utc).isoformat(),
        "baseModel": base_model,
        "epochs": epochs,
        "imageSize": image_size,
    }


def infer(project_root: Path, image: Path, confidence: float, image_size: int, device: str | None):
    paths = project_paths(project_root)
    if not paths["weights"].exists():
        return {**status(project_root, device), "ready": False, "detections": [], "reason": "No trained model weights found."}
    if inference_backend_status(project_root, device)["selected"] == "directml":
        import cv2
        from ultralyticsWorker import DirectMlBackend

        frame = cv2.imread(str(image), cv2.IMREAD_COLOR)
        if frame is None:
            raise RuntimeError("Could not decode the received image frame.")
        detections = DirectMlBackend(paths["weights"]).predict(frame, confidence)
        return {**status(project_root, device), "ready": True, "detections": detections}
    YOLO = require_ultralytics()
    selected_device = torch_device_status(device)["selected"]
    model = YOLO(str(paths["weights"]))
    predictions = model.predict(source=str(image), conf=confidence, imgsz=image_size, verbose=False, device=selected_device)
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
                "source": "ultralytics-yolo",
            })
    return {**status(project_root, device), "ready": True, "detections": detections}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=["status", "train", "infer"])
    parser.add_argument("--project-root", required=True)
    parser.add_argument("--image")
    parser.add_argument("--confidence", type=float, default=0.55)
    parser.add_argument("--base-model", default="yolo26n.pt")
    parser.add_argument("--epochs", type=int, default=60)
    parser.add_argument("--image-size", type=int, default=960)
    parser.add_argument("--batch", type=int, default=None)
    parser.add_argument("--workers", type=int, default=None)
    parser.add_argument("--amp", default=None)
    parser.add_argument("--device", default=None)
    args = parser.parse_args()
    root = Path(args.project_root).resolve()
    try:
        if args.command == "status":
            result = status(root, args.device)
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
