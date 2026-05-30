import argparse
import json
import random
import re
import shutil
import sys
import tempfile
import zipfile
from datetime import datetime, timezone
from pathlib import Path

try:
    import yaml
except Exception:  # pragma: no cover - fallback is for bare Python installs.
    yaml = None


IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".bmp"}
DEFAULT_TARGET_NAME = "roboflow-draft-recognition"
DEFAULT_UNIVERSE_URL = "https://universe.roboflow.com/mobile-legends-draft-pick/mobile-legends-draft-recognition"
DEFAULT_SCOPE = "Mobile Legends draft hero recognition"


def now_iso():
    return datetime.now(timezone.utc).isoformat()


def positive_limit(value):
    number = int(value)
    return None if number <= 0 else number


def ensure_layout(target_root: Path):
    for relative in [
        "images/train",
        "images/val",
        "labels/train",
        "labels/val",
        "models",
        "runs",
        "runtime",
    ]:
        directory = target_root / relative
        directory.mkdir(parents=True, exist_ok=True)
        keep = directory / ".gitkeep"
        if not keep.exists():
            keep.write_text("", encoding="ascii")


def safe_name(value: str, label: str):
    if not re.match(r"^[A-Za-z0-9_.-]+$", value) or value in (".", ".."):
        raise RuntimeError(f"{label} must be a simple folder/file name, got: {value}")
    return value


def safe_extract_zip(archive: zipfile.ZipFile, target_root: Path):
    resolved_root = target_root.resolve()
    for member in archive.infolist():
        target = (resolved_root / member.filename).resolve()
        if target != resolved_root and resolved_root not in target.parents:
            raise RuntimeError(f"Refusing to extract zip member outside target directory: {member.filename}")
    archive.extractall(resolved_root)


def safe_clear_split(target_root: Path, split: str):
    allowed = [
        (target_root / "images" / split).resolve(),
        (target_root / "labels" / split).resolve(),
    ]
    root = target_root.resolve()
    for directory in allowed:
        if root not in directory.parents:
            raise RuntimeError(f"Refusing to clean outside dataset root: {directory}")
        if not directory.exists():
            continue
        for item in directory.iterdir():
            if item.name == ".gitkeep":
                continue
            if item.is_dir():
                shutil.rmtree(item)
            else:
                item.unlink()


def find_dataset_yaml(source_root: Path):
    direct_candidates = [
        source_root / "data.yaml",
        source_root / "dataset.yaml",
    ]
    for candidate in direct_candidates:
        if candidate.exists():
            return candidate
    candidates = sorted(
        [
            *source_root.rglob("data.yaml"),
            *source_root.rglob("dataset.yaml"),
        ],
        key=lambda path: (len(path.relative_to(source_root).parts), path.as_posix()),
    )
    if not candidates:
        raise RuntimeError("Could not find data.yaml or dataset.yaml in the Roboflow export.")
    return candidates[0]


def load_yaml(path: Path):
    text = path.read_text(encoding="utf-8")
    if yaml is not None:
        data = yaml.safe_load(text) or {}
        if not isinstance(data, dict):
            raise RuntimeError(f"{path} is not a YOLO dataset mapping.")
        return text, data
    return text, parse_simple_yaml(text)


def parse_simple_yaml(text: str):
    data = {}
    names = {}
    in_names = False
    for raw in text.splitlines():
        line = raw.split("#", 1)[0].rstrip()
        if not line.strip():
            continue
        if not line.startswith(" ") and ":" in line:
            key, value = line.split(":", 1)
            key = key.strip()
            value = value.strip()
            in_names = key == "names"
            if value:
                data[key] = strip_quotes(value)
            elif in_names:
                data[key] = names
            continue
        if in_names:
            match = re.match(r"^\s*(\d+):\s*(.+?)\s*$", line)
            if match:
                names[int(match.group(1))] = strip_quotes(match.group(2).strip())
    return data


def strip_quotes(value: str):
    if (value.startswith('"') and value.endswith('"')) or (value.startswith("'") and value.endswith("'")):
        return value[1:-1]
    return value


def normalize_names(raw_names):
    if isinstance(raw_names, list):
        names = {index: str(name).strip() for index, name in enumerate(raw_names)}
    elif isinstance(raw_names, dict):
        names = {int(class_id): str(name).strip() for class_id, name in raw_names.items()}
    else:
        raise RuntimeError("Source dataset does not contain YOLO class names.")
    if not names:
        raise RuntimeError("Source dataset contains no class names.")
    missing = [class_id for class_id in range(max(names) + 1) if class_id not in names]
    if missing:
        raise RuntimeError(f"Source dataset has missing class ids: {missing[:10]}")
    return names


def write_local_dataset_yaml(target_root: Path, names):
    lines = [
        "path: .",
        "train: images/train",
        "val: images/val",
        "",
        "names:",
    ]
    for class_id, name in sorted(names.items()):
        safe = name.replace('"', '\\"')
        lines.append(f'  {class_id}: "{safe}"')
    (target_root / "dataset.yaml").write_text("\n".join(lines) + "\n", encoding="utf-8")
    (target_root / "classes.json").write_text(json.dumps(names, indent=2), encoding="utf-8")


def resolve_base_dir(dataset_file: Path, data: dict):
    raw_base = data.get("path")
    if not raw_base or str(raw_base).strip() in (".", ""):
        return dataset_file.parent
    candidate = Path(str(raw_base))
    if candidate.is_absolute():
        return candidate
    resolved = (dataset_file.parent / candidate).resolve()
    return resolved if resolved.exists() else dataset_file.parent


def candidate_split_dirs(source_root: Path, dataset_file: Path, data: dict, split: str):
    base_dir = resolve_base_dir(dataset_file, data)
    raw_values = []
    if split == "val":
        raw_values.extend([data.get("val"), data.get("valid"), data.get("validation")])
    else:
        raw_values.append(data.get(split))
    candidates = []
    for raw in raw_values:
        if raw is None:
            continue
        if isinstance(raw, list):
            raw = raw[0] if raw else ""
        raw_path = Path(str(raw).replace("\\", "/"))
        if raw_path.is_absolute():
            candidates.append(raw_path)
        else:
            candidates.append((base_dir / raw_path).resolve())
            candidates.append((dataset_file.parent / raw_path).resolve())
    defaults = {
        "train": ["train/images", "images/train"],
        "val": ["valid/images", "val/images", "validation/images", "test/images", "images/val", "images/valid", "images/test"],
    }
    for relative in defaults[split]:
        candidates.append((dataset_file.parent / relative).resolve())
        candidates.append((source_root / relative).resolve())
    seen = set()
    unique = []
    for candidate in candidates:
        key = candidate.as_posix().lower()
        if key not in seen:
            unique.append(candidate)
            seen.add(key)
    return unique


def find_split_dir(source_root: Path, dataset_file: Path, data: dict, split: str):
    for candidate in candidate_split_dirs(source_root, dataset_file, data, split):
        if candidate.exists() and candidate.is_dir():
            return candidate
    if split == "val":
        return None
    raise RuntimeError(f"Could not find {split} images directory in the Roboflow export.")


def image_files(image_dir: Path):
    return sorted(path for path in image_dir.rglob("*") if path.is_file() and path.suffix.lower() in IMAGE_EXTENSIONS)


def replace_last_part(path: Path, old: str, new: str):
    parts = list(path.parts)
    for index in range(len(parts) - 1, -1, -1):
        if parts[index].lower() == old:
            parts[index] = new
            return Path(*parts)
    return None


def label_candidates(image: Path, image_dir: Path, source_root: Path, source_split: str, target_split: str):
    relative = image.relative_to(image_dir).with_suffix(".txt")
    candidates = []
    if image_dir.name.lower() == "images":
        candidates.append(image_dir.parent / "labels" / relative)
    replaced = replace_last_part(image, "images", "labels")
    if replaced is not None:
        candidates.append(replaced.with_suffix(".txt"))
    candidates.extend([
        image.with_suffix(".txt"),
        source_root / source_split / "labels" / relative,
        source_root / target_split / "labels" / relative,
        source_root / "labels" / source_split / relative,
        source_root / "labels" / target_split / relative,
    ])
    if target_split == "val":
        candidates.extend([
            source_root / "valid" / "labels" / relative,
            source_root / "validation" / "labels" / relative,
            source_root / "test" / "labels" / relative,
            source_root / "labels" / "valid" / relative,
            source_root / "labels" / "test" / relative,
        ])
    seen = set()
    unique = []
    for candidate in candidates:
        key = candidate.resolve().as_posix().lower()
        if key not in seen:
            unique.append(candidate)
            seen.add(key)
    return unique


def find_label(image: Path, image_dir: Path, source_root: Path, source_split: str, target_split: str):
    for candidate in label_candidates(image, image_dir, source_root, source_split, target_split):
        if candidate.exists() and candidate.is_file():
            return candidate
    return None


def validate_label_text(text: str, class_count: int, source_path: Path):
    clean_lines = []
    for line_number, raw_line in enumerate(text.splitlines(), start=1):
        line = raw_line.strip()
        if not line:
            continue
        parts = line.split()
        if len(parts) != 5:
            raise RuntimeError(f"{source_path}:{line_number} is not YOLO class/x/y/w/h format.")
        class_id = int(float(parts[0]))
        if class_id < 0 or class_id >= class_count:
            raise RuntimeError(f"{source_path}:{line_number} class id {class_id} is outside 0..{class_count - 1}.")
        values = [float(part) for part in parts[1:]]
        if any(value < 0 or value > 1 for value in values):
            raise RuntimeError(f"{source_path}:{line_number} has normalized coordinates outside 0..1.")
        clean_lines.append(f"{class_id} " + " ".join(f"{value:.8f}".rstrip("0").rstrip(".") for value in values))
    return "\n".join(clean_lines) + ("\n" if clean_lines else "")


def unique_target_name(relative: Path, used_names: set[str]):
    candidate = relative.name
    if candidate not in used_names:
        used_names.add(candidate)
        return candidate
    prefix = re.sub(r"[^A-Za-z0-9_.-]+", "_", "_".join(relative.parts[:-1])).strip("_")
    candidate = f"{prefix}_{relative.name}" if prefix else relative.name
    counter = 2
    stem = Path(candidate).stem
    suffix = Path(candidate).suffix
    while candidate in used_names:
        candidate = f"{stem}_{counter}{suffix}"
        counter += 1
    used_names.add(candidate)
    return candidate


def copy_split(
    source_root: Path,
    image_dir: Path,
    target_root: Path,
    source_split: str,
    target_split: str,
    class_count: int,
    limit: int | None,
    shuffle: bool,
    seed: int,
    force: bool,
    allow_missing_labels: bool,
):
    images = image_files(image_dir)
    if shuffle:
        rng = random.Random(seed)
        rng.shuffle(images)
    if limit is not None:
        images = images[:limit]

    stats = {
        "selectedImages": len(images),
        "images": 0,
        "labels": 0,
        "skippedImages": 0,
        "skippedLabels": 0,
        "missingLabels": 0,
    }
    used_names = set()
    target_images = target_root / "images" / target_split
    target_labels = target_root / "labels" / target_split
    for index, image in enumerate(images, start=1):
        relative = image.relative_to(image_dir)
        target_name = unique_target_name(relative, used_names)
        image_target = target_images / target_name
        label_target = target_labels / f"{Path(target_name).stem}.txt"
        if image_target.exists() and not force:
            stats["skippedImages"] += 1
        else:
            image_target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(image, image_target)
            stats["images"] += 1

        label = find_label(image, image_dir, source_root, source_split, target_split)
        if label is None:
            if not allow_missing_labels:
                raise RuntimeError(f"No label file found for {image}")
            text = ""
            stats["missingLabels"] += 1
        else:
            text = validate_label_text(label.read_text(encoding="utf-8"), class_count, label)
        if label_target.exists() and not force:
            stats["skippedLabels"] += 1
        else:
            label_target.parent.mkdir(parents=True, exist_ok=True)
            label_target.write_text(text, encoding="ascii")
            stats["labels"] += 1
        if index % 100 == 0:
            print(f"{target_split}: imported {index}/{len(images)} images", file=sys.stderr)
    return stats


def import_from_root(source_root: Path, target_root: Path, args):
    ensure_layout(target_root)
    if args.clean:
        safe_clear_split(target_root, "train")
        safe_clear_split(target_root, "val")

    dataset_file = find_dataset_yaml(source_root)
    yaml_text, data = load_yaml(dataset_file)
    names = normalize_names(data.get("names"))
    write_local_dataset_yaml(target_root, names)

    train_dir = find_split_dir(source_root, dataset_file, data, "train")
    val_dir = find_split_dir(source_root, dataset_file, data, "val")
    if val_dir is None and args.require_val:
        raise RuntimeError("No validation image directory found in the Roboflow export.")

    imported = {
        "train": copy_split(
            source_root,
            train_dir,
            target_root,
            train_dir.parent.name,
            "train",
            len(names),
            args.max_train,
            args.shuffle,
            args.seed,
            args.force,
            args.allow_missing_labels,
        ),
        "val": {"selectedImages": 0, "images": 0, "labels": 0, "skippedImages": 0, "skippedLabels": 0, "missingLabels": 0},
    }
    if val_dir is not None:
        imported["val"] = copy_split(
            source_root,
            val_dir,
            target_root,
            val_dir.parent.name,
            "val",
            len(names),
            args.max_val,
            args.shuffle,
            args.seed + 1,
            args.force,
            args.allow_missing_labels,
        )

    manifest = {
        "source": {
            "type": "roboflow-universe-yolo-export",
            "path": str(args.source),
            "datasetYaml": str(dataset_file),
            "url": args.universe_url,
            "license": "CC BY 4.0",
            "scope": args.scope,
        },
        "importedAt": now_iso(),
        "datasetRoot": target_root.relative_to(args.project_root).as_posix(),
        "classes": {
            "count": len(names),
            "first": names.get(0),
            "last": names.get(max(names)),
            "names": names,
        },
        "imported": imported,
        "notes": [
            "This dataset is intentionally separate from the live gameplay detector.",
            f"Use it to train or evaluate {args.scope} without changing data/cv/mlbb-detection.yaml.",
            "Review class quality before using predictions in live logic; the source project may be small or lag current MLBB heroes.",
        ],
        "sourceDatasetYaml": yaml_text,
    }
    (target_root / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    return manifest


def main():
    parser = argparse.ArgumentParser(description="Import a Roboflow YOLO export for isolated MLBB CV experiments.")
    parser.add_argument("--project-root", default=".")
    parser.add_argument("--source", required=True, help="Path to a Roboflow YOLO zip export or extracted export directory.")
    parser.add_argument("--target-name", default=DEFAULT_TARGET_NAME, help="Folder under data/cv for this isolated experiment.")
    parser.add_argument("--universe-url", default=DEFAULT_UNIVERSE_URL, help="Roboflow Universe project URL to store in the manifest.")
    parser.add_argument("--scope", default=DEFAULT_SCOPE, help="Short human-readable scope stored in the manifest.")
    parser.add_argument("--max-train", type=positive_limit, default=None, help="Maximum train images to import. 0 or omitted means all.")
    parser.add_argument("--max-val", type=positive_limit, default=None, help="Maximum validation images to import. 0 or omitted means all.")
    parser.add_argument("--shuffle", action="store_true", help="Shuffle before applying max limits.")
    parser.add_argument("--seed", type=int, default=20260530)
    parser.add_argument("--force", action="store_true", help="Overwrite existing target images and labels with matching names.")
    parser.add_argument("--clean", action="store_true", help="Clear the isolated Roboflow draft train/val images and labels before importing.")
    parser.add_argument("--allow-missing-labels", action="store_true", help="Create empty label files for images missing YOLO labels.")
    parser.add_argument("--require-val", action="store_true", help="Fail if the export does not contain a validation split.")
    args = parser.parse_args()
    args.project_root = Path(args.project_root).resolve()
    args.source = Path(args.source).resolve()
    args.target_name = safe_name(args.target_name, "--target-name")
    target_root = args.project_root / "data" / "cv" / args.target_name

    try:
        if not args.source.exists():
            raise RuntimeError(f"Source does not exist: {args.source}")
        if args.source.is_dir():
            manifest = import_from_root(args.source, target_root, args)
        elif zipfile.is_zipfile(args.source):
            with tempfile.TemporaryDirectory(prefix="mlbb-roboflow-draft-") as temporary:
                with zipfile.ZipFile(args.source) as archive:
                    safe_extract_zip(archive, Path(temporary))
                manifest = import_from_root(Path(temporary), target_root, args)
        else:
            raise RuntimeError("--source must be a directory or zip archive.")
        print(json.dumps({"ok": True, "data": manifest}))
    except Exception as error:
        print(json.dumps({"ok": False, "error": str(error)}))
        sys.exit(1)


if __name__ == "__main__":
    main()
