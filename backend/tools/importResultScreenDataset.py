import argparse
import json
import random
import re
import sys
import time
import urllib.request
from datetime import datetime, timezone
from pathlib import Path


DEFAULT_REPO = "R-N/ml_yolo_dataset"
DEFAULT_REF = "main"
IMAGE_PATTERN = re.compile(r"^images/(train|test)/images/.+\.(jpg|jpeg|png)$", re.IGNORECASE)


def now_iso():
    return datetime.now(timezone.utc).isoformat()


def raw_base(repo, ref):
    return f"https://raw.githubusercontent.com/{repo}/{ref}/"


def raw_url(repo, ref, path):
    return raw_base(repo, ref) + urllib.request.quote(path)


def github_api_url(repo, ref):
    return f"https://api.github.com/repos/{repo}/git/trees/{ref}?recursive=1"


def read_url(url, binary=False, retries=3):
    last_error = None
    for attempt in range(retries):
        try:
            with urllib.request.urlopen(url, timeout=60) as response:
                data = response.read()
                return data if binary else data.decode("utf-8")
        except Exception as error:
            last_error = error
            if attempt + 1 < retries:
                time.sleep(1.5 * (attempt + 1))
    raise RuntimeError(f"Could not read {url}: {last_error}")


def parse_names(dataset_yaml):
    names = {}
    in_names = False
    for line in dataset_yaml.splitlines():
        stripped = line.strip()
        if stripped == "names:":
            in_names = True
            continue
        if not in_names:
            continue
        match = re.match(r"^(\d+):\s*(.+?)\s*$", stripped)
        if not match:
            if stripped and not line.startswith(" "):
                break
            continue
        class_id = int(match.group(1))
        label = match.group(2).strip()
        if (label.startswith('"') and label.endswith('"')) or (label.startswith("'") and label.endswith("'")):
            label = label[1:-1]
        names[class_id] = label
    if not names:
        raise RuntimeError("Source dataset.yaml did not contain YOLO names.")
    expected = list(range(max(names) + 1))
    missing = [class_id for class_id in expected if class_id not in names]
    if missing:
        raise RuntimeError(f"Source dataset.yaml has missing class ids: {missing[:10]}")
    return names


def write_local_dataset_yaml(target_root, names):
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


def ensure_layout(target_root):
    for relative in [
        "images/train",
        "images/val",
        "labels/train",
        "labels/val",
        "models",
        "runs",
        "runtime",
    ]:
        path = target_root / relative
        path.mkdir(parents=True, exist_ok=True)
        keep = path / ".gitkeep"
        if not keep.exists():
            keep.write_text("", encoding="ascii")


def load_tree(repo, ref):
    tree = json.loads(read_url(github_api_url(repo, ref)))
    if tree.get("truncated"):
        raise RuntimeError("GitHub tree response was truncated; refusing to import an incomplete dataset.")
    return tree.get("tree", [])


def split_entries(tree, max_train, max_val, shuffle, seed):
    image_paths = [entry["path"] for entry in tree if entry.get("type") == "blob" and IMAGE_PATTERN.match(entry["path"])]
    train = [path for path in image_paths if path.startswith("images/train/")]
    val = [path for path in image_paths if path.startswith("images/test/")]
    train.sort()
    val.sort()
    if shuffle:
        rng = random.Random(seed)
        rng.shuffle(train)
        rng.shuffle(val)
    if max_train is not None:
        train = train[:max_train]
    if max_val is not None:
        val = val[:max_val]
    return {"train": train, "val": val}


def candidate_label_paths(image_path):
    path = Path(image_path)
    stem = path.stem
    split = "train" if image_path.startswith("images/train/") else "test"
    return [
        f"images/{split}/images/{stem}.txt",
        f"labels/{stem}.txt",
        f"images/labels/{stem}.txt",
    ]


def validate_label_text(text, class_count, source_path):
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


def download_file(repo, ref, source_path, target_path, force=False):
    if target_path.exists() and not force:
        return False
    target_path.parent.mkdir(parents=True, exist_ok=True)
    target_path.write_bytes(read_url(raw_url(repo, ref, source_path), binary=True))
    return True


def download_label(repo, ref, tree_paths, image_path, target_path, class_count, force=False):
    if target_path.exists() and not force:
        return False
    source_path = next((candidate for candidate in candidate_label_paths(image_path) if candidate in tree_paths), None)
    if not source_path:
        raise RuntimeError(f"No label file found for {image_path}")
    text = read_url(raw_url(repo, ref, source_path))
    target_path.parent.mkdir(parents=True, exist_ok=True)
    target_path.write_text(validate_label_text(text, class_count, source_path), encoding="ascii")
    return True


def download_split(repo, ref, split, image_paths, tree_paths, target_root, class_count, force):
    stats = {"images": 0, "labels": 0, "skippedImages": 0, "skippedLabels": 0}
    for index, image_path in enumerate(image_paths, start=1):
        basename = Path(image_path).name
        stem = Path(image_path).stem
        image_target = target_root / "images" / split / basename
        label_target = target_root / "labels" / split / f"{stem}.txt"
        if download_file(repo, ref, image_path, image_target, force=force):
            stats["images"] += 1
        else:
            stats["skippedImages"] += 1
        if download_label(repo, ref, tree_paths, image_path, label_target, class_count, force=force):
            stats["labels"] += 1
        else:
            stats["skippedLabels"] += 1
        if index % 100 == 0:
            print(f"{split}: imported {index}/{len(image_paths)} images", file=sys.stderr)
    return stats


def positive_limit(value):
    number = int(value)
    return None if number <= 0 else number


def main():
    parser = argparse.ArgumentParser(description="Prepare a separate MLBB post-match result-screen YOLO dataset.")
    parser.add_argument("--project-root", default=".")
    parser.add_argument("--repo", default=DEFAULT_REPO)
    parser.add_argument("--ref", default=DEFAULT_REF)
    parser.add_argument("--download", action="store_true", help="Download selected image and label files. Omit for metadata-only setup.")
    parser.add_argument("--max-train", type=positive_limit, default=None, help="Maximum train images to import. 0 or omitted means all.")
    parser.add_argument("--max-val", type=positive_limit, default=None, help="Maximum validation images to import. 0 or omitted means all.")
    parser.add_argument("--shuffle", action="store_true", help="Shuffle before applying max limits.")
    parser.add_argument("--seed", type=int, default=20260529)
    parser.add_argument("--force", action="store_true")
    parser.add_argument("--skip-results", action="store_true", help="Do not download results.csv metadata.")
    args = parser.parse_args()

    project_root = Path(args.project_root).resolve()
    target_root = project_root / "data" / "cv" / "result-screens"
    ensure_layout(target_root)

    source_yaml = read_url(raw_url(args.repo, args.ref, "dataset.yaml"))
    names = parse_names(source_yaml)
    write_local_dataset_yaml(target_root, names)
    (target_root / "classes.json").write_text(json.dumps(names, indent=2), encoding="utf-8")
    if not args.skip_results:
        download_file(args.repo, args.ref, "results.csv", target_root / "results.csv", force=args.force)

    imported = {
        "train": {"images": 0, "labels": 0, "skippedImages": 0, "skippedLabels": 0},
        "val": {"images": 0, "labels": 0, "skippedImages": 0, "skippedLabels": 0},
    }
    selected = {"train": 0, "val": 0}
    source_counts = {"train": None, "val": None}

    if args.download:
        tree = load_tree(args.repo, args.ref)
        tree_paths = {entry["path"] for entry in tree if entry.get("type") == "blob"}
        splits = split_entries(tree, args.max_train, args.max_val, args.shuffle, args.seed)
        selected = {split: len(paths) for split, paths in splits.items()}
        all_splits = split_entries(tree, None, None, False, args.seed)
        source_counts = {split: len(paths) for split, paths in all_splits.items()}
        imported["train"] = download_split(args.repo, args.ref, "train", splits["train"], tree_paths, target_root, len(names), args.force)
        imported["val"] = download_split(args.repo, args.ref, "val", splits["val"], tree_paths, target_root, len(names), args.force)

    manifest = {
        "source": {
            "repo": args.repo,
            "ref": args.ref,
            "url": f"https://github.com/{args.repo}",
            "license": "MIT",
            "scope": "Mobile Legends post-match result screens",
        },
        "importedAt": now_iso(),
        "datasetRoot": target_root.relative_to(project_root).as_posix(),
        "classes": {
            "count": len(names),
            "first": names.get(0),
            "last": names.get(max(names)),
        },
        "downloaded": bool(args.download),
        "sourceCounts": source_counts,
        "selected": selected,
        "imported": imported,
        "notes": [
            "This dataset is intentionally separate from the live gameplay detector.",
            "Source hero classes stop at Arlott; newer MLBB heroes require additional labels before broad result-screen hero recognition.",
            "The result-screen model should detect UI regions and hero/result objects; OCR should still read numbers/text such as battle id and duration.",
        ],
    }
    (target_root / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    print(json.dumps({"ok": True, "data": manifest}))


if __name__ == "__main__":
    main()
