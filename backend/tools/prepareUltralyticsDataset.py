import json
import random
import shutil
import subprocess
from pathlib import Path

from PIL import Image, ImageDraw, ImageEnhance, ImageOps


CLASS_IDS = {
    "minimap_panel": 0,
    "draft_screen": 1,
    "equipment_scoreboard": 2,
    "attributes_scoreboard": 3,
    "ally_pick_slot": 4,
    "enemy_pick_slot": 5,
    "ally_ban_slot": 6,
    "enemy_ban_slot": 7,
    "lane_marker": 8,
    "battle_spell_marker": 9,
    "ally_hero_marker": 10,
    "enemy_hero_marker": 11,
    "turtle": 12,
    "lord": 13,
    "ally_turret": 14,
    "enemy_turret": 15,
    "turtle_respawn_timer": 16,
    "lord_respawn_timer": 17,
    "enemy_respawn_timer": 18,
    "ally_respawn_timer": 19,
    "minimap_objective_timer": 20,
    "score_counter": 21,
}

DRAFT_REGIONS = {
    "ally_pick_rail": [0.0, 0.083042, 0.162621, 0.832224],
    "enemy_pick_rail": [0.842233, 0.084847, 0.157767, 0.828613],
    "ally_ban_rail": [0.035599, 0.0, 0.224919, 0.086652],
    "enemy_ban_rail": [0.737055, 0.0, 0.222492, 0.088458],
}
LIVE_MINIMAP_REGION = [0.028361, 0.0, 0.140756, 0.314063]
SCOREBOARD_REGION = [0.1, 0.13, 0.8, 0.78]
BAN_SLOTS = {"legend": 4, "mythic": 5}
ROW_STEP = 0.16645
SPELL_SLOT_BASE = [0.106, 0.109, 0.026, 0.058]
SELF_LANE_RECTS = {
    "legend": [0.052, 0.09 + ROW_STEP * 3, 0.045, 0.1],
    "mythic": [0.015, 0.485, 0.036, 0.045],
}
SELF_LANE_SPRITE_INDEX = {"legend": 0, "mythic": 4}
FINALIZED_DRAFT_SECONDS = {
    "legend": {"train": [300, 302], "val": [304]},
    "mythic": {"train": [208], "val": [210]},
}
FINALIZED_DRAFT_FRAMES = {
    "legend": "samples/video-analysis/legend/keyframes/draft-final.png",
    "mythic": "samples/video-analysis/mythic/keyframes/draft-final.png",
}
SCOREBOARD_FIXTURES = [
    ("frontend/public/assets/fixtures/live/equipment-scoreboard.png", "train", "equipment_scoreboard"),
    ("frontend/public/assets/fixtures/live/equipment-scoreboard-late.png", "val", "equipment_scoreboard"),
    ("frontend/public/assets/fixtures/live/attributes-scoreboard.png", "train", "attributes_scoreboard"),
]
SPELL_SPRITES = [
    "S20100.png",
    "S20020.png",
    "S20030.png",
    "S20220.png",
    "S20190.png",
    "S20070.png",
    "S20150.png",
    "S20040.png",
    "S20080.png",
    "S20060.png",
    "S20050.png",
]
MYTHIC_CONFIRMED_SPELL_SPRITES = ["S20020.png", "S20150.png", "S20100.png", "S20100.png", "S20100.png"]
EXTRA_TRAINING_SECONDS = {
    "legend": {
        "draft": [125, 135, 175, 180, 215, 220, 255, 260, 290, 295],
        "live_hud": [395, 400, 405, 410, 415, 425, 430, 435, 505, 510, 515, 605, 610],
    },
    "mythic": {
        "draft": [80, 90, 120, 130, 160, 170, 195, 205],
        "live_hud": [245, 250, 255, 305, 310, 315, 425, 430, 435, 605, 610],
    },
}
SYNTHETIC_MINIMAP_SAMPLES = {"train": 36, "val": 8}
SYNTHETIC_FRAME_SIZE = (1920, 1080)
MINIMAP_SPRITE_FILES = {
    "ally_hero_marker": ["Atlas_BattleGround/sprites/Map_MyHead.png"],
    "enemy_hero_marker": ["Atlas_BattleGround/sprites/Map_EnemyHead.png"],
    "ally_turret": ["Atlas_BattleGround/sprites/Map_MyTower.png"],
    "enemy_turret": ["Atlas_BattleGround/sprites/Map_EnemyTower.png"],
    "turtle": ["Atlas_BattleGround/sprites/Map_Turtle01.png", "Atlas_BattleGround/sprites/Map_Turtle02.png"],
    "lord": [
        "Atlas_BattleGround/sprites/Map_Lord01.png",
        "Atlas_BattleGround/sprites/Map_Lord02.png",
        "Atlas_BattleGround/sprites/Map_Lord03.png",
        "Atlas_BattleGround/sprites/Map_Lord04.png",
    ],
}


def yolo_line(class_id, rect):
    x, y, width, height = rect
    return f"{class_id} {x + width / 2:.6f} {y + height / 2:.6f} {width:.6f} {height:.6f}"


def rect_pixels(image_size, rect):
    width, height = image_size
    x, y, rect_width, rect_height = rect
    return [
        round(x * width),
        round(y * height),
        round((x + rect_width) * width),
        round((y + rect_height) * height),
    ]


def minimap_inner_region(frame_size):
    frame_width, frame_height = frame_size
    x, y, width, height = LIVE_MINIMAP_REGION
    pixel_width = width * frame_width
    pixel_height = height * frame_height
    side = min(pixel_width, pixel_height)
    return [x, y, side / frame_width, side / frame_height]


def rect_inside(container, center_x, center_y, width, height):
    item_width = container[2] * width
    item_height = container[3] * height
    left = container[0] + container[2] * center_x - item_width / 2
    top = container[1] + container[3] * center_y - item_height / 2
    left = max(container[0], min(left, container[0] + container[2] - item_width))
    top = max(container[1], min(top, container[1] + container[3] - item_height))
    return [left, top, item_width, item_height]


def split_vertical(rect, count):
    x, y, width, height = rect
    part_height = height / count
    return [[x, y + part_height * index, width, part_height] for index in range(count)]


def split_horizontal(rect, count):
    x, y, width, height = rect
    part_width = width / count
    return [[x + part_width * index, y, part_width, height] for index in range(count)]


def draft_labels(recording_id):
    labels = [yolo_line(CLASS_IDS["draft_screen"], [0.0, 0.0, 1.0, 1.0])]
    labels.extend(yolo_line(CLASS_IDS["ally_pick_slot"], rect)
                  for rect in split_vertical(DRAFT_REGIONS["ally_pick_rail"], 5))
    labels.extend(yolo_line(CLASS_IDS["enemy_pick_slot"], rect)
                  for rect in split_vertical(DRAFT_REGIONS["enemy_pick_rail"], 5))
    labels.extend(yolo_line(CLASS_IDS["ally_ban_slot"], rect)
                  for rect in split_horizontal(DRAFT_REGIONS["ally_ban_rail"], BAN_SLOTS[recording_id]))
    labels.extend(yolo_line(CLASS_IDS["enemy_ban_slot"], rect)
                  for rect in split_horizontal(DRAFT_REGIONS["enemy_ban_rail"], BAN_SLOTS[recording_id]))
    return labels


def rect_for_spell_slot(slot):
    return [SPELL_SLOT_BASE[0], SPELL_SLOT_BASE[1] + ROW_STEP * (slot - 1), SPELL_SLOT_BASE[2], SPELL_SLOT_BASE[3]]


def finalized_draft_labels(recording_id):
    labels = draft_labels(recording_id)
    labels.append(yolo_line(CLASS_IDS["lane_marker"], SELF_LANE_RECTS[recording_id]))
    labels.extend(yolo_line(CLASS_IDS["battle_spell_marker"], rect_for_spell_slot(slot)) for slot in range(1, 6))
    return labels


def labels_for_sample(recording_id, label, finalized=False):
    if label == "draft":
        return finalized_draft_labels(recording_id) if finalized else draft_labels(recording_id)
    if label == "live_hud":
        return [yolo_line(CLASS_IDS["minimap_panel"], LIVE_MINIMAP_REGION)]
    if label in ("equipment_scoreboard", "attributes_scoreboard"):
        return [yolo_line(CLASS_IDS[label], SCOREBOARD_REGION)]
    return []


def locate_ffmpeg(project_root):
    bundled = project_root.parent / "OBS scrcpy source plugin" / "vendor" / "ffmpeg-8.0.1-full_build-shared" / "bin" / "ffmpeg.exe"
    if bundled.exists():
        return bundled
    path = shutil.which("ffmpeg")
    if path:
        return Path(path)
    raise RuntimeError("ffmpeg is required to extract additional reviewed recording frames.")


def write_sample(project_root, cv_root, source, split, recording_id, label, target_name, finalized=False, origin="recorded"):
    image_target = cv_root / "images" / split / target_name
    label_target = cv_root / "labels" / split / f"{Path(target_name).stem}.txt"
    labels = labels_for_sample(recording_id, label, finalized)
    shutil.copy2(source, image_target)
    label_target.write_text("\n".join(labels) + ("\n" if labels else ""), encoding="ascii")
    return {
        "image": image_target.relative_to(project_root).as_posix(),
        "sourceLabel": label,
        "objects": len(labels),
        "origin": origin,
    }


def write_explicit_sample(project_root, cv_root, source, split, target_name, labels, source_label, origin):
    image_target = cv_root / "images" / split / target_name
    label_target = cv_root / "labels" / split / f"{Path(target_name).stem}.txt"
    shutil.copy2(source, image_target)
    label_target.write_text("\n".join(labels) + ("\n" if labels else ""), encoding="ascii")
    return {
        "image": image_target.relative_to(project_root).as_posix(),
        "sourceLabel": source_label,
        "objects": len(labels),
        "origin": origin,
    }


def extract_frame(ffmpeg, source_video, seconds, target):
    subprocess.run([
        str(ffmpeg), "-y", "-hide_banner", "-loglevel", "error",
        "-ss", str(seconds), "-i", str(source_video),
        "-frames:v", "1", "-q:v", "2", str(target),
    ], check=True)


def paste_asset(image, source, rect):
    width, height = image.size
    x = round(rect[0] * width)
    y = round(rect[1] * height)
    target_width = max(1, round(rect[2] * width))
    target_height = max(1, round(rect[3] * height))
    asset = Image.open(source).convert("RGBA")
    fitted = ImageOps.contain(asset, (target_width, target_height), Image.Resampling.LANCZOS)
    layer = Image.new("RGBA", image.size, (0, 0, 0, 0))
    layer.alpha_composite(fitted, (x + (target_width - fitted.width) // 2, y + (target_height - fitted.height) // 2))
    image.alpha_composite(layer)


def draw_timer_box(image, rect, text, fill):
    draw = ImageDraw.Draw(image, "RGBA")
    box = rect_pixels(image.size, rect)
    radius = max(2, round((box[3] - box[1]) * 0.35))
    draw.rounded_rectangle(box, radius=radius, fill=(7, 10, 13, 220), outline=(255, 255, 255, 95), width=1)
    text_box = draw.textbbox((0, 0), text)
    text_width = text_box[2] - text_box[0]
    text_height = text_box[3] - text_box[1]
    text_x = box[0] + max(1, (box[2] - box[0] - text_width) // 2)
    text_y = box[1] + max(1, (box[3] - box[1] - text_height) // 2) - 1
    draw.text((text_x, text_y), text, fill=fill)


def draw_synthetic_battle_background(rng):
    image = Image.new("RGBA", SYNTHETIC_FRAME_SIZE, (18, 22, 24, 255))
    draw = ImageDraw.Draw(image, "RGBA")
    width, height = SYNTHETIC_FRAME_SIZE

    for _ in range(24):
        x0 = rng.randint(0, width)
        y0 = rng.randint(0, height)
        x1 = x0 + rng.randint(100, 420)
        y1 = y0 + rng.randint(20, 120)
        color = rng.choice([(38, 57, 49, 70), (62, 56, 42, 55), (35, 43, 58, 65), (58, 42, 47, 52)])
        draw.rectangle([x0, y0, x1, y1], fill=color)

    draw.line([(240, 1040), (930, 580), (1730, 88)], fill=(165, 132, 86, 64), width=24)
    draw.line([(120, 780), (580, 540), (910, 260)], fill=(72, 116, 132, 54), width=18)
    draw.rectangle([0, 0, width, 62], fill=(8, 10, 13, 210))
    draw.rectangle([0, height - 128, width, height], fill=(8, 10, 13, 176))

    for index in range(5):
        center_x = width - 420 + index * 74
        center_y = height - 78 + rng.randint(-4, 4)
        draw.ellipse([center_x - 28, center_y - 28, center_x + 28, center_y + 28],
                     fill=(24, 31, 38, 170), outline=(220, 220, 220, 62), width=2)
    return image


def minimap_sprite_sets(asset_root):
    sprite_sets = {}
    for label, relative_paths in MINIMAP_SPRITE_FILES.items():
        paths = [asset_root / relative_path for relative_path in relative_paths if (asset_root / relative_path).exists()]
        if not paths:
            raise RuntimeError(f"Missing extracted minimap sprite for {label}.")
        sprite_sets[label] = paths
    return sprite_sets


def add_minimap_marker(image, labels, sprite_sets, rng, label, center, size):
    rect = rect_inside(
        minimap_inner_region(image.size),
        center[0],
        center[1],
        size[0],
        size[1],
    )
    paste_asset(image, rng.choice(sprite_sets[label]), rect)
    labels.append(yolo_line(CLASS_IDS[label], rect))
    return rect


def jittered(center, rng, amount=0.035):
    return [
        max(0.08, min(0.92, center[0] + rng.uniform(-amount, amount))),
        max(0.08, min(0.92, center[1] + rng.uniform(-amount, amount))),
    ]


def add_respawn_timer(image, labels, class_name, marker_rect, rng):
    inner = minimap_inner_region(image.size)
    marker_center_x = (marker_rect[0] + marker_rect[2] / 2 - inner[0]) / inner[2]
    marker_center_y = (marker_rect[1] + marker_rect[3] / 2 - inner[1]) / inner[3]
    timer_rect = rect_inside(inner, marker_center_x, marker_center_y + 0.085, 0.105, 0.045)
    draw_timer_box(image, timer_rect, str(rng.randint(6, 48)), (240, 242, 245, 255))
    labels.append(yolo_line(CLASS_IDS[class_name], timer_rect))


def build_synthetic_minimap_sample(rng, background_sprite, sprite_sets, variant_index):
    image = draw_synthetic_battle_background(rng)
    labels = [yolo_line(CLASS_IDS["minimap_panel"], LIVE_MINIMAP_REGION)]
    draw = ImageDraw.Draw(image, "RGBA")
    panel_box = rect_pixels(image.size, LIVE_MINIMAP_REGION)
    map_region = minimap_inner_region(image.size)

    draw.rounded_rectangle(panel_box, radius=18, fill=(4, 7, 10, 190), outline=(255, 255, 255, 70), width=2)
    paste_asset(image, background_sprite, map_region)

    turret_centers = {
        "ally_turret": [(0.21, 0.74), (0.34, 0.63), (0.47, 0.84)],
        "enemy_turret": [(0.79, 0.26), (0.66, 0.37), (0.53, 0.16)],
    }
    for label, centers in turret_centers.items():
        for center in centers:
            add_minimap_marker(image, labels, sprite_sets, rng, label, jittered(center, rng, 0.018), (0.11, 0.13))

    ally_centers = [(0.25, 0.75), (0.36, 0.58), (0.44, 0.79), (0.19, 0.47), (0.52, 0.58)]
    enemy_centers = [(0.75, 0.25), (0.64, 0.42), (0.56, 0.21), (0.82, 0.53), (0.49, 0.38)]
    rng.shuffle(ally_centers)
    rng.shuffle(enemy_centers)
    for center in ally_centers[:rng.randint(3, 5)]:
        marker_rect = add_minimap_marker(image, labels, sprite_sets, rng, "ally_hero_marker", jittered(center, rng), (0.115, 0.115))
        if rng.random() < 0.34:
            add_respawn_timer(image, labels, "ally_respawn_timer", marker_rect, rng)
    for center in enemy_centers[:rng.randint(3, 5)]:
        marker_rect = add_minimap_marker(image, labels, sprite_sets, rng, "enemy_hero_marker", jittered(center, rng), (0.115, 0.115))
        if rng.random() < 0.42:
            add_respawn_timer(image, labels, "enemy_respawn_timer", marker_rect, rng)

    objective_label = "turtle" if variant_index % 2 == 0 else "lord"
    objective_center = jittered((0.62, 0.56) if objective_label == "turtle" else (0.39, 0.43), rng, 0.025)
    add_minimap_marker(image, labels, sprite_sets, rng, objective_label, objective_center, (0.082, 0.082))
    objective_pair_index = variant_index // 2
    if objective_label == "turtle":
        timer_class = "turtle_respawn_timer" if objective_pair_index % 2 == 0 else "minimap_objective_timer"
    else:
        timer_class = "lord_respawn_timer" if objective_pair_index % 2 == 0 else "minimap_objective_timer"
    timer_rect = rect_inside(map_region, objective_center[0], objective_center[1] + 0.092, 0.165, 0.052)
    draw_timer_box(image, timer_rect, f"0:{rng.randint(10, 59):02d}", (255, 236, 164, 255))
    labels.append(yolo_line(CLASS_IDS[timer_class], timer_rect))
    return image, labels


def add_asset_augmented_draft_samples(project_root, cv_root, prepared):
    rng = random.Random(20260526)
    asset_root = project_root / "data" / "adb-assets" / "textures"
    lane_sprites = [asset_root / "Atlas_ChooseLane02_add" / "sprites" / f"LaneIcon{index:02d}.png" for index in range(1, 6)]
    spell_sprites = [asset_root / "Atlas_SkillIcon" / "sprites" / filename for filename in SPELL_SPRITES]
    sources = {key: project_root / path for key, path in FINALIZED_DRAFT_FRAMES.items()}
    if not all(source.exists() for source in [*lane_sprites, *spell_sprites, *sources.values()]):
        raise RuntimeError("Missing extracted lane/spell asset required for draft augmentation.")

    synthetic_dir = cv_root / "runtime" / "asset-composited-draft"
    synthetic_dir.mkdir(parents=True, exist_ok=True)
    for recording_id, base_source in sources.items():
        for index in range(16):
            output_name = f"{recording_id}-draft-asset-augmented-{index:02d}.jpg"
            output = synthetic_dir / output_name
            image = Image.open(base_source).convert("RGBA")
            paste_asset(image, lane_sprites[SELF_LANE_SPRITE_INDEX[recording_id]], SELF_LANE_RECTS[recording_id])
            shuffled_spells = (
                [asset_root / "Atlas_SkillIcon" / "sprites" / filename for filename in MYTHIC_CONFIRMED_SPELL_SPRITES]
                if recording_id == "mythic"
                else rng.sample(spell_sprites, 5)
            )
            for slot, sprite in enumerate(shuffled_spells, start=1):
                paste_asset(image, sprite, rect_for_spell_slot(slot))
            image.convert("RGB").save(output, quality=94)
            prepared["train"].append(write_sample(
                project_root, cv_root, output, "train", recording_id, "draft", output_name,
                finalized=True, origin="official-asset-composite"))


def add_asset_synthetic_minimap_samples(project_root, cv_root, prepared):
    rng = random.Random(20260527)
    asset_root = project_root / "data" / "adb-assets" / "textures"
    background_sprite = asset_root / "Atlas_minimap_add" / "sprites" / "minimapbg.png"
    if not background_sprite.exists():
        raise RuntimeError("Missing extracted minimap background asset.")

    sprite_sets = minimap_sprite_sets(asset_root)
    prepared["officialAssetReferences"]["minimapHud"] = {
        "background": background_sprite.relative_to(project_root).as_posix(),
        "sprites": {
            label: [path.relative_to(project_root).as_posix() for path in paths]
            for label, paths in sprite_sets.items()
        },
    }

    synthetic_dir = cv_root / "runtime" / "asset-synthetic-minimap"
    synthetic_dir.mkdir(parents=True, exist_ok=True)
    variant_index = 0
    for split, count in SYNTHETIC_MINIMAP_SAMPLES.items():
        for index in range(count):
            output_name = f"synthetic-minimap-{split}-{index:02d}.jpg"
            output = synthetic_dir / output_name
            image, labels = build_synthetic_minimap_sample(rng, background_sprite, sprite_sets, variant_index)
            image.convert("RGB").save(output, quality=94)
            prepared[split].append(write_explicit_sample(
                project_root,
                cv_root,
                output,
                split,
                output_name,
                labels,
                "asset_synthetic_minimap",
                "official-asset-synthetic",
            ))
            variant_index += 1


def add_scoreboard_samples(project_root, cv_root, prepared):
    synthetic_dir = cv_root / "runtime" / "scoreboard-augmented"
    synthetic_dir.mkdir(parents=True, exist_ok=True)
    for fixture, split, label in SCOREBOARD_FIXTURES:
        source = project_root / fixture
        output_name = f"{Path(fixture).stem}-recorded.png"
        prepared[split].append(write_sample(
            project_root, cv_root, source, split, "live", label, output_name, origin="recorded-fixture"))
        if split != "train":
            continue
        for index, factor in enumerate((0.86, 0.94, 1.06, 1.14), start=1):
            image = Image.open(source).convert("RGB")
            image = ImageEnhance.Brightness(image).enhance(factor)
            image = ImageEnhance.Contrast(image).enhance(1.0 + (factor - 1.0) * 0.45)
            augmented = synthetic_dir / f"{Path(fixture).stem}-tone-{index}.jpg"
            image.save(augmented, quality=94)
            prepared["train"].append(write_sample(
                project_root, cv_root, augmented, "train", "live", label, augmented.name,
                origin="recorded-color-augmentation"))


def add_user_annotations(project_root, cv_root, prepared):
    metadata_root = cv_root / "annotations" / "metadata"
    if not metadata_root.exists():
        return
    for split in ("train", "val"):
        source_metadata = metadata_root / split
        if not source_metadata.exists():
            continue
        for metadata_file in source_metadata.glob("*.json"):
            metadata = json.loads(metadata_file.read_text(encoding="utf-8"))
            image_name = metadata["imageName"]
            label_name = f"{metadata['id']}.txt"
            source_image = cv_root / "annotations" / "images" / split / image_name
            source_label = cv_root / "annotations" / "labels" / split / label_name
            if not source_image.exists() or not source_label.exists():
                continue
            shutil.copy2(source_image, cv_root / "images" / split / image_name)
            shutil.copy2(source_label, cv_root / "labels" / split / label_name)
            object_count = len([line for line in source_label.read_text(encoding="ascii").splitlines() if line.strip()])
            prepared[split].append({
                "image": (cv_root / "images" / split / image_name).relative_to(project_root).as_posix(),
                "sourceLabel": "user_annotation",
                "objects": object_count,
                "origin": "cv-lab",
            })


def main():
    project_root = Path(__file__).resolve().parents[2]
    manifest_file = project_root / "data" / "recognition-samples" / "screen-state-training-set.json"
    frames_dir = project_root / "data" / "recognition-samples" / "raw" / "screen-state-training"
    cv_root = project_root / "data" / "cv"
    manifest = json.loads(manifest_file.read_text(encoding="utf-8"))

    for split in ("train", "val"):
        images_dir = cv_root / "images" / split
        labels_dir = cv_root / "labels" / split
        images_dir.mkdir(parents=True, exist_ok=True)
        labels_dir.mkdir(parents=True, exist_ok=True)
        for target_dir in (images_dir, labels_dir):
            for existing in target_dir.iterdir():
                if existing.name != ".gitkeep" and existing.is_file():
                    existing.unlink()

    prepared = {
        "train": [],
        "val": [],
        "classesUsed": sorted(CLASS_IDS),
        "negativeClass": "loading",
        "officialAssetReferences": {
            "laneSprites": "data/adb-assets/textures/Atlas_ChooseLane02_add/sprites/LaneIcon01..05.png",
            "battleSpells": [f"data/adb-assets/textures/Atlas_SkillIcon/sprites/{name}" for name in SPELL_SPRITES],
        },
    }
    for recording in manifest["recordings"]:
        recording_id = recording["id"]
        for sample in recording["samples"]:
            split = "val" if sample["split"] == "validation" else "train"
            name = f"{recording_id}-{sample['label']}-{sample['split']}-{sample['second']}.jpg"
            source = frames_dir / name
            if not source.exists():
                raise RuntimeError(f"Missing reviewed frame: {source}")

            prepared[split].append(write_sample(
                project_root, cv_root, source, split, recording_id, sample["label"], name))

    ffmpeg = locate_ffmpeg(project_root)
    extract_dir = cv_root / "runtime" / "expanded-recording-frames"
    extract_dir.mkdir(parents=True, exist_ok=True)
    recordings = {recording["id"]: project_root / recording["file"] for recording in manifest["recordings"]}
    for recording_id, classes in EXTRA_TRAINING_SECONDS.items():
        source_video = recordings[recording_id]
        for label, seconds in classes.items():
            for second in seconds:
                name = f"{recording_id}-{label}-expanded-{second}.jpg"
                extracted = extract_dir / name
                extract_frame(ffmpeg, source_video, second, extracted)
                prepared["train"].append(write_sample(
                    project_root, cv_root, extracted, "train", recording_id, label, name))

    for recording_id, split_seconds in FINALIZED_DRAFT_SECONDS.items():
        source_video = recordings[recording_id]
        source_keyframe = project_root / FINALIZED_DRAFT_FRAMES[recording_id]
        name = f"{recording_id}-draft-final-recorded.png"
        prepared["train"].append(write_sample(
            project_root, cv_root, source_keyframe, "train", recording_id, "draft", name,
            finalized=True, origin="recorded-finalized-draft"))
        for split, seconds in split_seconds.items():
            for second in seconds:
                name = f"{recording_id}-draft-finalized-{split}-{second}.jpg"
                extracted = extract_dir / name
                extract_frame(ffmpeg, source_video, second, extracted)
                prepared[split].append(write_sample(
                    project_root, cv_root, extracted, split, recording_id, "draft", name,
                    finalized=True, origin="recorded-finalized-draft"))

    add_asset_augmented_draft_samples(project_root, cv_root, prepared)
    add_asset_synthetic_minimap_samples(project_root, cv_root, prepared)
    add_scoreboard_samples(project_root, cv_root, prepared)
    add_user_annotations(project_root, cv_root, prepared)

    output = cv_root / "runtime" / "bootstrap-dataset-manifest.json"
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(prepared, indent=2) + "\n", encoding="ascii")
    print(json.dumps({
        "ok": True,
        "trainImages": len(prepared["train"]),
        "validationImages": len(prepared["val"]),
        "trainObjects": sum(item["objects"] for item in prepared["train"]),
        "validationObjects": sum(item["objects"] for item in prepared["val"]),
        "classesUsed": prepared["classesUsed"],
        "officialAssetReferences": {
            "laneSprites": 5,
            "battleSpells": len(SPELL_SPRITES),
            "minimapSprites": sum(len(paths) for paths in MINIMAP_SPRITE_FILES.values()) + 1,
        },
        "manifest": str(output),
    }))


if __name__ == "__main__":
    main()
