"""
Analyze active YOLO dataset: resolutions, label coverage vs layout profiles, Roboflow mix.
Writes data/cv/runtime/dataset-analysis.json
"""

from __future__ import annotations

import json
import sys
from collections import Counter, defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from cvDatasetAlign import draft_slot_coverage, relabel_yolo_lines, roboflow_profile_allowed  # noqa: E402
from cvLayoutProfiles import select_profile  # noqa: E402

try:
    from PIL import Image
except ImportError:
    Image = None

IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".bmp"}
CLASS_NAMES = [
    "minimap_panel", "draft_screen", "equipment_scoreboard", "attributes_scoreboard",
    "ally_pick_slot", "enemy_pick_slot", "ally_ban_slot", "enemy_ban_slot",
    "lane_marker", "battle_spell_marker", "ally_hero_marker", "enemy_hero_marker",
    "turtle", "lord", "ally_turret", "enemy_turret",
]


def categorize_name(name: str) -> str:
    if name.startswith("roboflow-"):
        return "roboflow"
    if "synthetic-minimap" in name:
        return "synthetic-minimap"
    if "asset-augmented" in name or "asset-composite" in name:
        return "asset-draft"
    if "expanded" in name:
        return "expanded"
    if name.startswith("legend-") or name.startswith("mythic-"):
        return "manifest"
    if name.startswith("user-"):
        return "user"
    if "scoreboard" in name:
        return "fixture"
    return "other"


def main():
    if Image is None:
        raise RuntimeError("Pillow is required. Use data/cv/.venv or pip install pillow.")

    project_root = Path(__file__).resolve().parents[2]
    cv_root = project_root / "data" / "cv"
    report = {
        "splits": {},
        "recommendations": [],
    }

    for split in ("train", "val"):
        image_dir = cv_root / "images" / split
        label_dir = cv_root / "labels" / split
        if not image_dir.exists():
            continue

        resolution_counter = Counter()
        aspect_counter = Counter()
        origin_counter = Counter()
        class_counter = Counter()
        profile_counter = Counter()
        draft_coverage: list[float] = []
        roboflow_excluded = 0
        misaligned_draft = 0

        for image_path in sorted(path for path in image_dir.iterdir() if path.suffix.lower() in IMAGE_EXTENSIONS):
            origin = categorize_name(image_path.name)
            origin_counter[origin] += 1

            try:
                with Image.open(image_path) as image:
                    width, height = image.size
            except Exception:
                continue

            resolution_counter[(width, height)] += 1
            profile = select_profile(width, height)
            profile_counter[profile["id"]] += 1
            aspect = round(width / max(height, 1), 3)
            if abs(aspect - 20 / 9) < 0.05:
                aspect_counter["20:9"] += 1
            elif abs(aspect - 16 / 9) < 0.05:
                aspect_counter["16:9"] += 1
            elif abs(aspect - 2.0) < 0.05:
                aspect_counter["2:1"] += 1
            else:
                aspect_counter["other"] += 1

            label_path = label_dir / f"{image_path.stem}.txt"
            if not label_path.exists():
                continue
            raw_lines = [line for line in label_path.read_text(encoding="ascii", errors="ignore").splitlines() if line.strip()]
            for line in raw_lines:
                class_counter[int(float(line.split()[0]))] += 1

            recording_id = "mythic" if image_path.name.startswith("mythic") else "legend" if image_path.name.startswith("legend") else "mythic"
            if origin == "roboflow" and "camera-objectives" in image_path.name:
                roboflow_excluded += 1

            draft_lines = [line for line in raw_lines if line.split()[0] in {"1", "4", "5", "6", "7"}]
            if len(draft_lines) >= 8:
                coverage = draft_slot_coverage(raw_lines, recording_id, profile)
                mean_iou = sum(coverage.values()) / max(len(coverage), 1)
                draft_coverage.append(mean_iou)
                aligned = relabel_yolo_lines(raw_lines, width, height, recording_id)
                aligned_cov = draft_slot_coverage(aligned, recording_id, profile)
                aligned_mean = sum(aligned_cov.values()) / max(len(aligned_cov), 1)
                if mean_iou < 0.55 and aligned_mean > mean_iou + 0.15:
                    misaligned_draft += 1

        report["splits"][split] = {
            "images": sum(origin_counter.values()),
            "origins": dict(origin_counter),
            "topResolutions": [{"width": w, "height": h, "count": c} for (w, h), c in resolution_counter.most_common(12)],
            "aspectBuckets": dict(aspect_counter),
            "layoutProfiles": dict(profile_counter),
            "topClasses": [
                {"classId": cid, "name": CLASS_NAMES[cid] if cid < len(CLASS_NAMES) else f"class_{cid}", "count": count}
                for cid, count in class_counter.most_common(15)
            ],
            "draftMeanSlotIoU": round(sum(draft_coverage) / len(draft_coverage), 4) if draft_coverage else None,
            "draftFramesScored": len(draft_coverage),
            "draftFramesNeedingRealign": misaligned_draft,
            "roboflowCameraObjectiveFrames": roboflow_excluded,
        }

    train = report["splits"].get("train", {})
    if train.get("origins", {}).get("roboflow", 0) > 500 and train.get("roboflowCameraObjectiveFrames", 0) > 100:
        report["recommendations"].append(
            "Exclude Roboflow camera-objectives from mlbb-detect prepare; it teaches jungle buff crops, not HUD anchors."
        )
    if train.get("draftMeanSlotIoU") is not None and train["draftMeanSlotIoU"] < 0.65:
        report["recommendations"].append(
            "Run cv:prepare to snap draft Roboflow boxes to per-aspect slot rails (cvDatasetAlign)."
        )
    if train.get("aspectBuckets", {}).get("20:9", 0) < 50:
        report["recommendations"].append(
            "Add more 20:9 phone captures (2856×1280) — primary live device profile."
        )

    output = cv_root / "runtime" / "dataset-analysis.json"
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"ok": True, "report": str(output.relative_to(project_root)), "splits": report["splits"]}, indent=2))


if __name__ == "__main__":
    main()
