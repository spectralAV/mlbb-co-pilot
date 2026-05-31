import argparse
import json
import os
import random
import re
import shutil
import sys
import tempfile
import time
import urllib.parse
import urllib.request
import zipfile
from pathlib import Path

from importRoboflowDraftDataset import (
    find_dataset_yaml,
    find_label,
    find_split_dir,
    image_files,
    load_yaml,
    normalize_names,
    now_iso,
    positive_limit,
    safe_extract_zip,
    safe_name,
)


IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".bmp"}
DEFAULT_TARGET_NAME = "roboflow-enhancement"
DEFAULT_UNIVERSE_URL = "https://universe.roboflow.com"

MAIN_CLASSES = [
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
MAIN_CLASS_IDS = {name: index for index, name in enumerate(MAIN_CLASSES)}

DRAFT_REGIONS = {
    "ally_pick_slot": [0.0, 0.083042, 0.162621, 0.832224],
    "enemy_pick_slot": [0.842233, 0.084847, 0.157767, 0.828613],
    "ally_ban_slot": [0.035599, 0.0, 0.224919, 0.086652],
    "enemy_ban_slot": [0.737055, 0.0, 0.222492, 0.088458],
}

DIRECT_ALIASES = {
    "map": "minimap_panel",
    "mini_map": "minimap_panel",
    "minimap": "minimap_panel",
    "minimap_": "minimap_panel",
    "draft": "draft_screen",
    "draft_pick": "draft_screen",
    "draft_screen_": "draft_screen",
    "equipment": "equipment_scoreboard",
    "item_scoreboard": "equipment_scoreboard",
    "items_scoreboard": "equipment_scoreboard",
    "attributes": "attributes_scoreboard",
    "attribute_scoreboard": "attributes_scoreboard",
    "ally_pick": "ally_pick_slot",
    "blue_pick": "ally_pick_slot",
    "my_pick": "ally_pick_slot",
    "enemy_pick": "enemy_pick_slot",
    "red_pick": "enemy_pick_slot",
    "ally_ban": "ally_ban_slot",
    "blue_ban": "ally_ban_slot",
    "enemy_ban": "enemy_ban_slot",
    "red_ban": "enemy_ban_slot",
    "lane": "lane_marker",
    "spell": "battle_spell_marker",
    "battle_spell": "battle_spell_marker",
    "ally_hero": "ally_hero_marker",
    "blue_hero": "ally_hero_marker",
    "my_hero": "ally_hero_marker",
    "hero_icon": "enemy_hero_marker",
    "hero_icons": "enemy_hero_marker",
    "enemy_hero": "enemy_hero_marker",
    "red_hero": "enemy_hero_marker",
    "tower": "enemy_turret",
    "turret": "enemy_turret",
    "turret_icon": "enemy_turret",
    "turrent": "enemy_turret",
    "turrent_icon": "enemy_turret",
    "timer": "match_timer",
    "match_timer": "match_timer",
    "game_timer": "match_timer",
    "kda": "personal_kda",
    "personal_kda": "personal_kda",
    "gold": "personal_gold_counter",
    "personal_gold": "personal_gold_counter",
    "score_kda_gold_timer": "live_hud_stats_region",
    "hud_stats": "live_hud_stats_region",
    "red_buff": "red_buff",
    "red_mark": "red_buff",
    "blue_buff": "blue_buff",
    "blue_buff_": "blue_buff",
    "little_wonder": "little_wonder",
    "wonder": "little_wonder",
    "monster": "jungle_creep",
    "monsters": "jungle_creep",
    "jungle_creep": "jungle_creep",
}

ITEM_LABEL_OVERRIDES = {
    "flower_of_hope",
    "lantern_of_hope",
    "obsidia",
}
HERO_LABEL_OVERRIDES = {
    "kalea",
    "lukas",
    "marcel",
    "sora",
    "suyou",
    "zetian",
}
ITEM_HINT_TOKENS = (
    "armor",
    "axe",
    "belt",
    "blade",
    "boots",
    "breastplate",
    "claws",
    "codex",
    "crystal",
    "dagger",
    "glaive",
    "gloves",
    "gun",
    "helmet",
    "lantern",
    "mallet",
    "meteor",
    "necklace",
    "pauldron",
    "roar",
    "robe",
    "scythe",
    "shield",
    "shoes",
    "spear",
    "staff",
    "sword",
    "talisman",
    "tomahawk",
    "truncheon",
    "wand",
    "wings",
)


def normalize_label(value: str):
    return re.sub(r"_+", "_", re.sub(r"[^a-z0-9]+", "_", str(value).strip().lower())).strip("_")


def load_catalog_labels(project_root: Path, filename: str):
    catalog = project_root / "data" / "cache" / filename
    if not catalog.exists():
        return set()
    try:
        entries = json.loads(catalog.read_text(encoding="utf-8"))
    except Exception:
        return set()
    labels = set()
    if not isinstance(entries, list):
        return labels
    for entry in entries:
        if not isinstance(entry, dict):
            continue
        for key in ("name", "display_name", "hero_name", "slug"):
            value = entry.get(key)
            if value:
                labels.add(normalize_label(value))
        raw = entry.get("raw")
        if isinstance(raw, dict):
            for key in ("name", "display_name", "hero_name", "slug"):
                value = raw.get(key)
                if value:
                    labels.add(normalize_label(value))
    return labels


def yolo_line(class_name: str, center_box):
    class_id = MAIN_CLASS_IDS[class_name]
    cx, cy, width, height = center_box
    return f"{class_id} {cx:.6f} {cy:.6f} {width:.6f} {height:.6f}"


def rect_to_center(rect):
    x, y, width, height = rect
    return [x + width / 2, y + height / 2, width, height]


def clamp01(value: float):
    return max(0.0, min(1.0, value))


def clamp_box(center_box):
    cx, cy, width, height = center_box
    width = clamp01(width)
    height = clamp01(height)
    cx = clamp01(cx)
    cy = clamp01(cy)
    return [cx, cy, width, height]


def split_horizontal(rect, count):
    x, y, width, height = rect
    part_width = width / count
    return [[x + part_width * index, y, part_width, height] for index in range(count)]


def split_vertical(rect, count):
    x, y, width, height = rect
    part_height = height / count
    return [[x, y + part_height * index, width, part_height] for index in range(count)]


def slot_index(value: float, start: float, size: float, count: int):
    if size <= 0:
        return 0
    return max(0, min(count - 1, int((value - start) / size * count)))


def direct_class_for_label(label: str):
    normalized = normalize_label(label)
    if normalized in MAIN_CLASS_IDS:
        return normalized
    if normalized in DIRECT_ALIASES:
        return DIRECT_ALIASES[normalized]
    if "turtle" in normalized:
        return "turtle_respawn_timer" if "timer" in normalized or "respawn" in normalized else "turtle"
    if "lord" in normalized:
        return "lord_respawn_timer" if "timer" in normalized or "respawn" in normalized else "lord"
    if "score" in normalized and ("counter" in normalized or "kill" in normalized):
        return "score_counter"
    if "objective" in normalized and "timer" in normalized:
        return "minimap_objective_timer"
    if "turret" in normalized or "tower" in normalized:
        return "ally_turret" if side_from_label(normalized, "enemy") == "ally" else "enemy_turret"
    if "hero_marker" in normalized or normalized.endswith("_hero"):
        return f"{side_from_label(normalized, 'enemy')}_hero_marker"
    return None


def side_from_label(label: str, default_side: str):
    normalized = normalize_label(label)
    ally_tokens = ("ally", "blue", "my", "own", "friendly", "team")
    enemy_tokens = ("enemy", "red", "opponent", "opp", "foe")
    if any(token in normalized for token in ally_tokens):
        return "ally"
    if any(token in normalized for token in enemy_tokens):
        return "enemy"
    return default_side


def minimap_class_for_label(label: str, default_side: str):
    direct = direct_class_for_label(label)
    if direct:
        return direct
    normalized = normalize_label(label)
    ignored_tokens = ("item", "spell", "lane", "score", "buff", "wonder", "jungle")
    if any(token in normalized for token in ignored_tokens):
        return None
    return f"{side_from_label(normalized, default_side)}_hero_marker"


def hud_ocr_boxes_for_label(label: str, center_box):
    normalized = normalize_label(label)
    if normalized in ("timer", "match_timer", "game_timer"):
        return [("match_timer", center_box)]
    if normalized in ("kda", "personal_kda"):
        return [("personal_kda", center_box)]
    if normalized in ("gold", "personal_gold", "personal_gold_counter"):
        return [("personal_gold_counter", center_box)]
    if normalized in ("score_kda_gold_timer", "hud_stats", "live_hud_stats", "live_hud_stats_region"):
        return [("live_hud_stats_region", center_box)]
    if normalized in ("score", "kills", "team_score", "team_kills", "kill_score"):
        cx, cy, width, height = center_box
        if width >= max(0.04, height * 1.8):
            return [
                ("ally_kill_counter", [cx - width / 4, cy, width / 2, height]),
                ("enemy_kill_counter", [cx + width / 4, cy, width / 2, height]),
            ]
        side_class = "ally_kill_counter" if cx < 0.5 else "enemy_kill_counter"
        return [(side_class, center_box)]
    direct = direct_class_for_label(label)
    return [(direct, center_box)] if direct else []


def camera_objective_class_for_label(label: str):
    normalized = normalize_label(label)
    if "red" in normalized and ("buff" in normalized or "mark" in normalized):
        return "red_buff"
    if "blue" in normalized and "buff" in normalized:
        return "blue_buff"
    if "little" in normalized and "wonder" in normalized:
        return "little_wonder"
    if normalized in ("wonder", "little_wonder"):
        return "little_wonder"
    if "turtle" in normalized:
        return "turtle"
    if "lord" in normalized:
        return "lord"
    if "monster" in normalized or "creep" in normalized or "jungle" in normalized:
        return "jungle_creep"
    return direct_class_for_label(label)


def post_match_item_class_for_label(label: str, args):
    normalized = normalize_label(label)
    if not normalized or normalized == "empty":
        return None
    if not hasattr(args, "_item_label_keys"):
        args._item_label_keys = load_catalog_labels(args.project_root, "items.json") | ITEM_LABEL_OVERRIDES
        args._hero_label_keys = load_catalog_labels(args.project_root, "heroes.json") | HERO_LABEL_OVERRIDES
    if normalized in args._item_label_keys:
        return "post_match_item_slot"
    if normalized in args._hero_label_keys:
        return None
    if any(token in normalized for token in ITEM_HINT_TOKENS):
        return "post_match_item_slot"
    return None


def draft_slot_for_box(center_box, ban_slots: int, box_mode: str):
    cx, cy, width, height = center_box
    if cy <= 0.18:
        class_name = "ally_ban_slot" if cx < 0.5 else "enemy_ban_slot"
        if box_mode == "source":
            return class_name, center_box
        region = DRAFT_REGIONS[class_name]
        index = slot_index(cx, region[0], region[2], ban_slots)
        return class_name, rect_to_center(split_horizontal(region, ban_slots)[index])
    if cx <= 0.36:
        class_name = "ally_pick_slot"
        if box_mode == "source":
            return class_name, center_box
        region = DRAFT_REGIONS[class_name]
        index = slot_index(cy, region[1], region[3], 5)
        return class_name, rect_to_center(split_vertical(region, 5)[index])
    if cx >= 0.64:
        class_name = "enemy_pick_slot"
        if box_mode == "source":
            return class_name, center_box
        region = DRAFT_REGIONS[class_name]
        index = slot_index(cy, region[1], region[3], 5)
        return class_name, rect_to_center(split_vertical(region, 5)[index])
    return None, None


def resolve_profile(requested: str, dataset_name: str, universe_url: str):
    if requested != "auto":
        return requested
    haystack = f"{dataset_name} {universe_url}".lower()
    if "draft" in haystack or "pick" in haystack or "ban" in haystack:
        return "draft-slots"
    if "minimap" in haystack or "mini-map" in haystack or "map" in haystack:
        return "minimap-markers"
    if "ocr" in haystack:
        return "hud-ocr"
    if "item" in haystack:
        return "post-match-items"
    if "video-annotation" in haystack or "buff" in haystack or "jungle" in haystack or "creep" in haystack:
        return "camera-objectives"
    return "direct"


def source_box_to_main(profile: str, source_label: str, center_box, args):
    if profile == "draft-slots":
        class_name, converted = draft_slot_for_box(center_box, args.draft_ban_slots, args.draft_box_mode)
        return [(class_name, converted)] if class_name and converted else []
    if profile == "minimap-markers":
        class_name = minimap_class_for_label(source_label, args.default_minimap_side)
        return [(class_name, center_box)] if class_name else []
    if profile == "hud-ocr":
        return hud_ocr_boxes_for_label(source_label, center_box)
    if profile == "camera-objectives":
        class_name = camera_objective_class_for_label(source_label)
        return [(class_name, center_box)] if class_name else []
    if profile == "post-match-items":
        class_name = post_match_item_class_for_label(source_label, args)
        return [(class_name, center_box)] if class_name else []
    class_name = direct_class_for_label(source_label)
    return [(class_name, center_box)] if class_name else []


def convert_label_text(text: str, source_names, source_path: Path, profile: str, args):
    converted = []
    source_objects = 0
    skipped_objects = 0
    for line_number, raw_line in enumerate(text.splitlines(), start=1):
        line = raw_line.strip()
        if not line:
            continue
        parts = line.split()
        if len(parts) != 5:
            raise RuntimeError(f"{source_path}:{line_number} is not YOLO class/x/y/w/h format.")
        class_id = int(float(parts[0]))
        if class_id not in source_names:
            raise RuntimeError(f"{source_path}:{line_number} class id {class_id} is not declared in dataset names.")
        values = [float(part) for part in parts[1:]]
        if any(value < 0 or value > 1 for value in values):
            raise RuntimeError(f"{source_path}:{line_number} has normalized coordinates outside 0..1.")
        source_objects += 1
        mapped = source_box_to_main(profile, source_names[class_id], clamp_box(values), args)
        if not mapped:
            skipped_objects += 1
            continue
        for class_name, center_box in mapped:
            converted.append(yolo_line(class_name, clamp_box(center_box)))

    if profile == "draft-slots" and converted and args.add_draft_screen:
        converted.insert(0, yolo_line("draft_screen", [0.5, 0.5, 1.0, 1.0]))

    deduped = list(dict.fromkeys(converted))
    return {
        "text": "\n".join(deduped) + ("\n" if deduped else ""),
        "sourceObjects": source_objects,
        "convertedObjects": len(deduped),
        "skippedObjects": skipped_objects,
    }


def write_dataset_yaml(target_root: Path):
    lines = [
        "path: .",
        "train: images/train",
        "val: images/val",
        "",
        "names:",
    ]
    for class_id, name in enumerate(MAIN_CLASSES):
        lines.append(f"  {class_id}: {name}")
    (target_root / "dataset.yaml").write_text("\n".join(lines) + "\n", encoding="ascii")


def ensure_layout(target_root: Path):
    for relative in ("images/train", "images/val", "labels/train", "labels/val"):
        directory = target_root / relative
        directory.mkdir(parents=True, exist_ok=True)
        keep = directory / ".gitkeep"
        if not keep.exists():
            keep.write_text("", encoding="ascii")


def safe_clear(target_root: Path):
    root = target_root.resolve()
    for relative in ("images/train", "images/val", "labels/train", "labels/val"):
        directory = (target_root / relative).resolve()
        if root not in directory.parents:
            raise RuntimeError(f"Refusing to clean outside Roboflow training root: {directory}")
        if not directory.exists():
            continue
        for item in directory.iterdir():
            if item.name == ".gitkeep":
                continue
            if item.is_dir():
                shutil.rmtree(item)
            else:
                item.unlink()


def unique_target_name(dataset_name: str, relative: Path, used_names: set[str]):
    safe_prefix = normalize_label(dataset_name).replace("_", "-") or "roboflow"
    candidate = f"{safe_prefix}-{relative.name}"
    counter = 2
    while candidate in used_names:
        candidate = f"{safe_prefix}-{relative.stem}-{counter}{relative.suffix}"
        counter += 1
    used_names.add(candidate)
    return candidate


def copy_converted_split(source_root: Path, image_dir: Path, target_root: Path, source_names, source_split: str, target_split: str, profile: str, args):
    images = image_files(image_dir)
    if args.shuffle:
        rng = random.Random(args.seed + (1 if target_split == "val" else 0))
        rng.shuffle(images)
    limit = args.max_val if target_split == "val" else args.max_train
    if limit is not None:
        images = images[:limit]

    stats = {
        "selectedImages": len(images),
        "images": 0,
        "labels": 0,
        "sourceObjects": 0,
        "convertedObjects": 0,
        "skippedObjects": 0,
        "missingLabels": 0,
        "emptyAfterConversion": 0,
    }
    used_names = set()
    for index, image in enumerate(images, start=1):
        label = find_label(image, image_dir, source_root, source_split, target_split)
        if label is None:
            stats["missingLabels"] += 1
            if not args.allow_missing_labels:
                continue
            conversion = {"text": "", "sourceObjects": 0, "convertedObjects": 0, "skippedObjects": 0}
        else:
            conversion = convert_label_text(label.read_text(encoding="utf-8"), source_names, label, profile, args)
        stats["sourceObjects"] += conversion["sourceObjects"]
        stats["convertedObjects"] += conversion["convertedObjects"]
        stats["skippedObjects"] += conversion["skippedObjects"]
        if not conversion["text"].strip() and not args.keep_empty_images:
            stats["emptyAfterConversion"] += 1
            continue

        relative = image.relative_to(image_dir)
        target_name = unique_target_name(args.dataset_name, relative, used_names)
        image_target = target_root / "images" / target_split / target_name
        label_target = target_root / "labels" / target_split / f"{Path(target_name).stem}.txt"
        image_target.parent.mkdir(parents=True, exist_ok=True)
        label_target.parent.mkdir(parents=True, exist_ok=True)
        if not image_target.exists() or args.force:
            shutil.copy2(image, image_target)
            stats["images"] += 1
        if not label_target.exists() or args.force:
            label_target.write_text(conversion["text"], encoding="ascii")
            stats["labels"] += 1
        if index % 100 == 0:
            print(f"{target_split}: converted {index}/{len(images)} Roboflow images", file=sys.stderr)
    return stats


def import_from_root(source_root: Path, target_root: Path, args):
    ensure_layout(target_root)
    if args.clean:
        safe_clear(target_root)

    dataset_file = find_dataset_yaml(source_root)
    yaml_text, data = load_yaml(dataset_file)
    source_names = normalize_names(data.get("names"))
    profile = resolve_profile(args.profile, args.dataset_name, args.universe_url)
    write_dataset_yaml(target_root)

    train_dir = find_split_dir(source_root, dataset_file, data, "train")
    val_dir = find_split_dir(source_root, dataset_file, data, "val")
    imported = {
        "train": copy_converted_split(source_root, train_dir, target_root, source_names, train_dir.parent.name, "train", profile, args),
        "val": {"selectedImages": 0, "images": 0, "labels": 0, "sourceObjects": 0, "convertedObjects": 0, "skippedObjects": 0, "missingLabels": 0, "emptyAfterConversion": 0},
    }
    if val_dir is not None:
        imported["val"] = copy_converted_split(source_root, val_dir, target_root, source_names, val_dir.parent.name, "val", profile, args)

    manifest = {
        "source": {
            "type": "roboflow-yolo-export",
            "path": str(args.source),
            "datasetYaml": str(dataset_file),
            "url": args.universe_url,
        },
        "importedAt": now_iso(),
        "datasetName": args.dataset_name,
        "datasetRoot": target_root.relative_to(args.project_root).as_posix(),
        "profile": profile,
        "mainClasses": MAIN_CLASSES,
        "sourceClasses": source_names,
        "imported": imported,
        "notes": [
            "Converted Roboflow data is staged for Ultralytics training enhancement.",
            "Run `npm run cv:prepare` to copy staged samples into data/cv/images and data/cv/labels.",
            "Run `npm run cv:train` after prepare to train mlbb-detect.pt with these converted samples included.",
            "Review model results before trusting a new Roboflow source; public datasets can be small, stale, cropped, or differently labelled.",
        ],
        "sourceDatasetYaml": yaml_text,
    }
    (target_root / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    return manifest


def count_files(directory: Path, extensions):
    if not directory.exists():
        return 0
    return sum(1 for path in directory.rglob("*") if path.is_file() and path.suffix.lower() in extensions)


def status(project_root: Path):
    root = project_root / "data" / "cv" / "roboflow-training"
    datasets = []
    if root.exists():
        for dataset_root in sorted(path for path in root.iterdir() if path.is_dir()):
            manifest_file = dataset_root / "manifest.json"
            manifest = {}
            if manifest_file.exists():
                try:
                    manifest = json.loads(manifest_file.read_text(encoding="utf-8"))
                except Exception:
                    manifest = {}
            datasets.append({
                "name": dataset_root.name,
                "profile": manifest.get("profile"),
                "manifest": str(manifest_file),
                "training": {
                    "images": count_files(dataset_root / "images" / "train", IMAGE_EXTENSIONS),
                    "labels": count_files(dataset_root / "labels" / "train", {".txt"}),
                },
                "validation": {
                    "images": count_files(dataset_root / "images" / "val", IMAGE_EXTENSIONS),
                    "labels": count_files(dataset_root / "labels" / "val", {".txt"}),
                },
            })
    return {
        "root": str(root),
        "datasetCount": len(datasets),
        "datasets": datasets,
        "notes": [
            "Use `npm run cv:roboflow:training:import -- --source <roboflow-yolo.zip> --dataset-name <name> --profile <direct|draft-slots|minimap-markers|hud-ocr|camera-objectives|post-match-items>` to stage data.",
            "Use `npm run cv:prepare` to include staged Roboflow data in the active Ultralytics dataset.",
        ],
    }


def roboflow_api_key(env_name: str):
    for name in (env_name, "ROBOFLOW_API_KEY", "RF_API_KEY", "ROBOFLOW_KEY"):
        value = os.environ.get(name)
        if value:
            return value
    raise RuntimeError(f"Set {env_name} or ROBOFLOW_API_KEY before downloading a Roboflow export.")


def roboflow_json(url: str):
    request = urllib.request.Request(url, headers={"User-Agent": "mlbb-copilot-dataset-importer"})
    with urllib.request.urlopen(request, timeout=90) as response:
        return json.loads(response.read().decode("utf-8"))


def latest_roboflow_version(workspace: str, project: str, key: str):
    url = f"https://api.roboflow.com/{workspace}/{project}?api_key={urllib.parse.quote(key)}"
    data = roboflow_json(url)
    root = data.get("project", data)
    versions = root.get("versions")
    if isinstance(versions, int) and versions > 0:
        return versions
    if isinstance(versions, list) and versions:
        return max(int(item.get("id") or item.get("version")) for item in versions)
    raise RuntimeError(f"Could not determine latest Roboflow version for {workspace}/{project}.")


def download_roboflow_export(args, temp_root: Path):
    key = roboflow_api_key(args.api_key_env)
    version = latest_roboflow_version(args.roboflow_workspace, args.roboflow_project, key) \
        if str(args.roboflow_version).lower() in ("", "latest", "auto") else int(args.roboflow_version)
    encoded_key = urllib.parse.quote(key)
    export_url = (
        f"https://api.roboflow.com/{args.roboflow_workspace}/{args.roboflow_project}/"
        f"{version}/{args.roboflow_format}?api_key={encoded_key}"
    )
    link = None
    progress = None
    for attempt in range(1, 7):
        data = roboflow_json(export_url)
        progress = data.get("progress")
        link = (data.get("export") or {}).get("link") or data.get("link")
        if link:
            break
        print(json.dumps({
            "event": "waiting-for-export",
            "workspace": args.roboflow_workspace,
            "project": args.roboflow_project,
            "version": version,
            "progress": progress,
            "attempt": attempt,
        }), file=sys.stderr)
        time.sleep(5 * attempt)
    if not link:
        raise RuntimeError(f"Roboflow export link was not ready; last progress={progress}")

    target = temp_root / f"{safe_name(args.dataset_name, '--dataset-name')}-v{version}.{args.roboflow_format}.zip"
    request = urllib.request.Request(link, headers={"User-Agent": "mlbb-copilot-dataset-importer"})
    with urllib.request.urlopen(request, timeout=300) as response, target.open("wb") as output:
        shutil.copyfileobj(response, output)
    return target


def run_import(args):
    args.project_root = Path(args.project_root).resolve()
    args.dataset_name = safe_name(args.dataset_name, "--dataset-name")
    target_root = args.project_root / "data" / "cv" / "roboflow-training" / args.dataset_name
    if args.source:
        args.source = Path(args.source).resolve()
        if not args.source.exists():
            raise RuntimeError(f"Source does not exist: {args.source}")
        if args.source.is_dir():
            return import_from_root(args.source, target_root, args)
        if zipfile.is_zipfile(args.source):
            with tempfile.TemporaryDirectory(prefix="mlbb-roboflow-training-") as temporary:
                with zipfile.ZipFile(args.source) as archive:
                    safe_extract_zip(archive, Path(temporary))
                return import_from_root(Path(temporary), target_root, args)
        raise RuntimeError("--source must be a directory or zip archive.")
    if args.roboflow_workspace and args.roboflow_project:
        with tempfile.TemporaryDirectory(prefix="mlbb-roboflow-download-") as download_root:
            args.source = download_roboflow_export(args, Path(download_root))
            with tempfile.TemporaryDirectory(prefix="mlbb-roboflow-training-") as temporary:
                with zipfile.ZipFile(args.source) as archive:
                    safe_extract_zip(archive, Path(temporary))
                return import_from_root(Path(temporary), target_root, args)
    raise RuntimeError("Provide --source or --roboflow-workspace plus --roboflow-project.")



def main():
    parser = argparse.ArgumentParser(description="Convert Roboflow YOLO exports into main Ultralytics training enhancements.")
    subparsers = parser.add_subparsers(dest="command", required=True)

    status_parser = subparsers.add_parser("status")
    status_parser.add_argument("--project-root", default=".")

    import_parser = subparsers.add_parser("import")
    import_parser.add_argument("--project-root", default=".")
    import_parser.add_argument("--source", help="Roboflow YOLO zip export or extracted export directory.")
    import_parser.add_argument("--roboflow-workspace", help="Roboflow workspace slug for API download.")
    import_parser.add_argument("--roboflow-project", help="Roboflow project slug for API download.")
    import_parser.add_argument("--roboflow-version", default="latest", help="Roboflow project version number, or latest.")
    import_parser.add_argument("--roboflow-format", default="yolov8", help="Roboflow export format.")
    import_parser.add_argument("--api-key-env", default="ROBOFLOW_API_KEY", help="Environment variable that contains the Roboflow API key.")
    import_parser.add_argument("--dataset-name", default=DEFAULT_TARGET_NAME, help="Folder under data/cv/roboflow-training.")
    import_parser.add_argument("--universe-url", default=DEFAULT_UNIVERSE_URL)
    import_parser.add_argument("--profile", choices=["auto", "direct", "draft-slots", "minimap-markers", "hud-ocr", "camera-objectives", "post-match-items"], default="auto")
    import_parser.add_argument("--default-minimap-side", choices=["ally", "enemy"], default="enemy")
    import_parser.add_argument("--draft-ban-slots", type=int, choices=[4, 5], default=5)
    import_parser.add_argument("--draft-box-mode", choices=["snap", "source"], default="snap")
    import_parser.add_argument("--add-draft-screen", action=argparse.BooleanOptionalAction, default=True)
    import_parser.add_argument("--max-train", type=positive_limit, default=None)
    import_parser.add_argument("--max-val", type=positive_limit, default=None)
    import_parser.add_argument("--shuffle", action="store_true")
    import_parser.add_argument("--seed", type=int, default=20260530)
    import_parser.add_argument("--force", action="store_true")
    import_parser.add_argument("--clean", action="store_true")
    import_parser.add_argument("--allow-missing-labels", action="store_true")
    import_parser.add_argument("--keep-empty-images", action="store_true")

    args = parser.parse_args()
    try:
        if args.command == "status":
            result = status(Path(args.project_root).resolve())
        else:
            result = run_import(args)
        print(json.dumps({"ok": True, "data": result}))
    except Exception as error:
        print(json.dumps({"ok": False, "error": str(error)}))
        sys.exit(1)


if __name__ == "__main__":
    main()
