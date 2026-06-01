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
    "match_timer",
    "ally_kill_counter",
    "enemy_kill_counter",
    "personal_kda",
    "personal_gold_counter",
    "live_hud_stats_region",
    "red_buff",
    "blue_buff",
    "jungle_creep",
    "little_wonder",
    "post_match_item_slot",
]

NO_CPU_TRAINING_MESSAGE = (
    "PyTorch CPU training is disabled. Configure CUDA or WSL ROCm before starting "
    "Ultralytics training."
)
DIRECTML_TRAINING_MESSAGE = (
    "PyTorch DirectML is installed, but Ultralytics training is not supported on DirectML. "
    "Use CUDA or WSL ROCm."
)

DIRECTML_ALIASES = ("directml", "dml", "amd", "amd-gpu")


def clean_device_name(value, fallback: str):
    text = str(value or "").replace("\x00", "").strip()
    return text or fallback


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


def torch_directml_status():
    info = {
        "directmlAvailable": False,
        "directmlVersion": None,
        "directmlDeviceCount": 0,
        "directmlDevices": [],
        "directmlWarning": "",
    }
    try:
        import torch_directml
    except Exception as error:
        info["directmlWarning"] = f"torch-directml is unavailable: {error}"
        return info

    info["directmlVersion"] = getattr(torch_directml, "__version__", None)
    try:
        is_available = getattr(torch_directml, "is_available", None)
        available = bool(is_available() if callable(is_available) else True)
    except Exception as error:
        info["directmlWarning"] = f"torch-directml availability check failed: {error}"
        available = False

    device_count = 1 if available else 0
    try:
        count_fn = getattr(torch_directml, "device_count", None)
        if callable(count_fn):
            device_count = int(count_fn())
    except Exception:
        pass

    devices = []
    for index in range(max(0, device_count)):
        try:
            name_fn = getattr(torch_directml, "device_name", None)
            devices.append(clean_device_name(name_fn(index), f"DirectML device {index}") if callable(name_fn) else f"DirectML device {index}")
        except Exception:
            devices.append(f"DirectML device {index}")

    info["directmlAvailable"] = bool(available and device_count > 0)
    info["directmlDeviceCount"] = max(0, device_count)
    info["directmlDevices"] = devices
    if available and device_count <= 0 and not info["directmlWarning"]:
        info["directmlWarning"] = "torch-directml is installed, but no DirectML device is visible."
    return info


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
        "directmlAvailable": False,
        "directmlVersion": None,
        "directmlDeviceCount": 0,
        "directmlDevices": [],
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
    directml = torch_directml_status()
    info["directmlAvailable"] = directml["directmlAvailable"]
    info["directmlVersion"] = directml["directmlVersion"]
    info["directmlDeviceCount"] = directml["directmlDeviceCount"]
    info["directmlDevices"] = directml["directmlDevices"]

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
        elif info["directmlAvailable"]:
            info["selected"] = "directml"
            info["type"] = "directml"
            info["name"] = info["directmlDevices"][0] if info["directmlDevices"] else "DirectML GPU"
        elif info["hipVersion"]:
            info["warning"] = "ROCm/HIP is installed, but no compatible GPU device is visible to PyTorch."
        elif directml["directmlWarning"]:
            info["warning"] = directml["directmlWarning"]
        return info

    info["selected"] = "0" if normalized in ("cuda", "rocm", "hip") else requested
    if normalized == "cpu":
        info["type"] = "cpu"
        info["name"] = "CPU"
    elif normalized == "mps":
        info["type"] = "mps"
        info["name"] = "Apple MPS"
    elif normalized in DIRECTML_ALIASES:
        info["selected"] = "directml"
        info["type"] = "directml"
        info["name"] = info["directmlDevices"][0] if info["directmlDevices"] else "DirectML GPU"
        if not info["directmlAvailable"]:
            info["warning"] = directml["directmlWarning"] or "DirectML was requested, but torch-directml is not available."
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


def training_device_argument(device_status):
    if str(device_status.get("type", "")).lower() != "directml":
        return device_status["selected"]
    try:
        import torch_directml
    except Exception as error:
        raise RuntimeError(f"DirectML training was selected, but torch-directml cannot be loaded: {error}") from error
    return torch_directml.device()


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


def copy_recent_annotations(paths, target_root: Path, split: str, limit: int, repeat: int):
    metadata_dir = paths["root"] / "annotations" / "metadata" / split
    if not metadata_dir.exists():
        return []
    image_dir = target_root / "images" / split
    label_dir = target_root / "labels" / split
    image_dir.mkdir(parents=True, exist_ok=True)
    label_dir.mkdir(parents=True, exist_ok=True)
    entries = []
    metadata_files = sorted(metadata_dir.glob("*.json"), key=lambda item: item.stat().st_mtime, reverse=True)
    for metadata_file in metadata_files[:max(1, limit)]:
        metadata = json.loads(metadata_file.read_text(encoding="utf-8"))
        image_name = metadata.get("imageName")
        if not image_name:
            continue
        source_image = paths["root"] / "annotations" / "images" / split / image_name
        source_label = paths["root"] / "annotations" / "labels" / split / f"{metadata.get('id', metadata_file.stem)}.txt"
        if not source_image.exists() or not source_label.exists():
            continue
        for index in range(max(1, repeat)):
            suffix = f"-r{index}" if repeat > 1 else ""
            target_image = image_dir / f"{metadata_file.stem}{suffix}{source_image.suffix.lower()}"
            target_label = label_dir / f"{target_image.stem}.txt"
            shutil.copy2(source_image, target_image)
            shutil.copy2(source_label, target_label)
            entries.append((target_image, target_label))
    return entries


def mirror_quick_validation(target_root: Path, train_entries):
    image_dir = target_root / "images" / "val"
    label_dir = target_root / "labels" / "val"
    image_dir.mkdir(parents=True, exist_ok=True)
    label_dir.mkdir(parents=True, exist_ok=True)
    entries = []
    for image, label in train_entries[:min(8, len(train_entries))]:
        target_image = image_dir / image.name
        target_label = label_dir / label.name
        shutil.copy2(image, target_image)
        shutil.copy2(label, target_label)
        entries.append((target_image, target_label))
    return entries


def prepare_correction_dataset(paths, recent_limit: int, repeat_manual: int):
    target_root = paths["runtime"] / "quick-correction"
    if target_root.exists():
        shutil.rmtree(target_root)
    train_entries = copy_recent_annotations(paths, target_root, "train", recent_limit, repeat_manual)
    val_entries = copy_recent_annotations(paths, target_root, "val", max(1, min(8, recent_limit)), 1)
    if not train_entries:
        raise RuntimeError("Save at least one training annotation before quick correction fine-tune.")
    if not val_entries:
        val_entries = mirror_quick_validation(target_root, train_entries)
    dataset = target_root / "mlbb-correction.yaml"
    dataset.write_text(
        paths["dataset"].read_text(encoding="utf-8").replace("path: .", f"path: '{target_root.as_posix()}'", 1),
        encoding="utf-8",
    )
    return {
        "dataset": str(dataset),
        "root": str(target_root),
        "trainImages": len(train_entries),
        "validationImages": len(val_entries),
        "sourceFrames": max(1, len(train_entries) // max(1, repeat_manual)),
        "repeatManual": max(1, repeat_manual),
    }


def should_stage_wsl_training(project_root: Path):
    return os.name != "nt" and project_root.as_posix().startswith("/mnt/")


def copy_training_tree(source_root: Path, target_root: Path):
    for relative in ("images/train", "images/val", "labels/train", "labels/val"):
        source = source_root / relative
        target = target_root / relative
        if target.exists():
            shutil.rmtree(target)
        target.parent.mkdir(parents=True, exist_ok=True)
        if source.exists():
            shutil.copytree(source, target)
        else:
            target.mkdir(parents=True, exist_ok=True)


def resolve_existing_model(project_root: Path, base_model: str):
    candidate = Path(base_model)
    if not candidate.is_absolute():
        candidate = project_root / base_model
    return candidate if candidate.exists() else None


def stage_training_workspace(project_root: Path, paths, dataset: Path, base_model: str, run_name: str, training_scope: str, quick_dataset):
    if not should_stage_wsl_training(project_root):
        return {
            "dataset": dataset,
            "baseModel": base_model,
            "project": paths["runs"],
            "staging": None,
        }

    work_root = Path(os.environ.get("MLBB_WSL_TRAINING_ROOT", Path.home() / ".mlbb-copilot" / "training")).expanduser()
    workspace = work_root / training_scope
    data_root = workspace / "dataset"
    if workspace.exists():
        shutil.rmtree(workspace)
    workspace.mkdir(parents=True, exist_ok=True)

    source_root = Path(quick_dataset["root"]) if quick_dataset else paths["root"]
    copy_training_tree(source_root, data_root)

    staged_dataset = workspace / f"{run_name}.yaml"
    staged_dataset.write_text(
        paths["dataset"].read_text(encoding="utf-8").replace("path: .", f"path: '{data_root.as_posix()}'", 1),
        encoding="utf-8",
    )

    staged_base_model = base_model
    existing_model = resolve_existing_model(project_root, base_model)
    if existing_model:
        staged_model = workspace / "base-model.pt"
        shutil.copy2(existing_model, staged_model)
        staged_base_model = str(staged_model)

    return {
        "dataset": staged_dataset,
        "baseModel": staged_base_model,
        "project": workspace / "runs",
        "staging": {
            "enabled": True,
            "workspace": str(workspace),
            "datasetRoot": str(data_root),
            "sourceRoot": str(source_root),
        },
    }


def mirror_staged_run(run_save_dir: Path, paths, run_name: str, staging):
    if not staging:
        return
    target = paths["runs"] / run_name
    if target.exists():
        shutil.rmtree(target)
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copytree(run_save_dir, target)


def train(
    project_root: Path,
    base_model: str,
    epochs: int,
    image_size: int,
    device: str | None,
    batch: int | None,
    workers: int | None,
    amp: bool | None,
    training_scope: str,
    recent_limit: int,
    repeat_manual: int,
):
    paths = project_paths(project_root)
    current = status(project_root, device)
    quick_dataset = None
    if training_scope == "correction":
        quick_dataset = prepare_correction_dataset(paths, recent_limit, repeat_manual)
    elif current["training"]["images"] == 0 or current["training"]["labels"] == 0:
        raise RuntimeError("Add labelled images and YOLO annotations before training.")
    require_training_accelerator(current["device"])
    selected_device = training_device_argument(current["device"])
    YOLO = require_ultralytics()
    paths["runs"].mkdir(parents=True, exist_ok=True)
    paths["runtime"].mkdir(parents=True, exist_ok=True)
    paths["weights"].parent.mkdir(parents=True, exist_ok=True)
    if quick_dataset:
        dataset = Path(quick_dataset["dataset"])
        run_name = "mlbb-correction"
    else:
        dataset = paths["runtime"] / "mlbb-training.yaml"
        dataset.write_text(
            paths["dataset"].read_text(encoding="utf-8").replace("path: .", f"path: '{paths['root'].as_posix()}'", 1),
            encoding="utf-8",
        )
        run_name = "mlbb-detection"
    staged = stage_training_workspace(project_root, paths, dataset, base_model, run_name, training_scope, quick_dataset)
    model = YOLO(staged["baseModel"])
    train_options = {
        "data": str(staged["dataset"]),
        "epochs": epochs,
        "imgsz": image_size,
        "project": str(staged["project"]),
        "name": run_name,
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
    if training_scope == "correction":
        train_options.update({
            "lr0": 0.002,
            "warmup_epochs": 0.5,
            "patience": 10,
            "plots": False,
        })
    run = model.train(**train_options)
    best = Path(run.save_dir) / "weights" / "best.pt"
    last = Path(run.save_dir) / "weights" / "last.pt"
    selected_weights = best if best.exists() else last
    if not selected_weights.exists():
        raise RuntimeError("Ultralytics training finished without a saved model.")
    shutil.copy2(selected_weights, paths["weights"])
    mirror_staged_run(Path(run.save_dir), paths, run_name, staged["staging"])
    if paths["onnx"].exists():
        paths["onnx"].unlink()
    return {
        **status(project_root, device),
        "trainedAt": datetime.now(timezone.utc).isoformat(),
        "baseModel": base_model,
        "epochs": epochs,
        "imageSize": image_size,
        "trainingScope": training_scope,
        "quickDataset": quick_dataset,
        "trainingStorage": staged["staging"],
    }


def require_training_accelerator(device_status):
    selected = str(device_status.get("selected", "")).lower()
    device_type = str(device_status.get("type", "")).lower()
    if selected == "cpu" or device_type == "cpu":
        raise RuntimeError(NO_CPU_TRAINING_MESSAGE)
    if device_type in ("cuda", "rocm") and not device_status.get("cudaAvailable"):
        raise RuntimeError(device_status.get("warning") or "PyTorch cannot see a compatible CUDA/ROCm training device.")
    if device_type == "directml":
        raise RuntimeError(DIRECTML_TRAINING_MESSAGE)


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
    parser.add_argument("--training-scope", choices=["full", "correction"], default="full")
    parser.add_argument("--recent-limit", type=int, default=32)
    parser.add_argument("--repeat-manual", type=int, default=8)
    args = parser.parse_args()
    root = Path(args.project_root).resolve()
    try:
        if args.command == "status":
            result = status(root, args.device)
        elif args.command == "train":
            result = train(
                root,
                args.base_model,
                args.epochs,
                args.image_size,
                args.device,
                args.batch,
                args.workers,
                parse_bool(args.amp),
                args.training_scope,
                args.recent_limit,
                args.repeat_manual,
            )
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
