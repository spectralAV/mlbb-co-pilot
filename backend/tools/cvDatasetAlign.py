"""
Align YOLO labels to layout-profile slot geometry and filter training imports.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from cvLayoutProfiles import (  # noqa: E402
    LAYOUT_PROFILES,
    PROFILE_BY_ID,
    RECORDING_BAN_SLOTS,
    draft_slot_rects,
    select_profile,
    stretch_normalized_rect,
)

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
}
ID_TO_NAME = {value: key for key, value in CLASS_IDS.items()}
DRAFT_SLOT_CLASSES = {4, 5, 6, 7, 1}
ANCHOR_CLASS_IDS = {0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27}

ROBOFLOW_INCLUDE_PROFILES = {
    "draft-slots",
    "local-game-capture-ultrawide-v2-weak-labels",
    "minimap-markers",
    "hud-ocr",
    "direct",
}
ROBOFLOW_EXCLUDE_PROFILES = {
    "camera-objectives",
    "post-match-items",
}


def yolo_to_xywh(line: str):
    parts = line.strip().split()
    if len(parts) != 5:
        return None
    class_id = int(float(parts[0]))
    cx, cy, width, height = map(float, parts[1:5])
    return class_id, [cx - width / 2, cy - height / 2, width, height]


def xywh_to_yolo(class_id: int, rect: list[float]) -> str:
    x, y, width, height = rect
    cx = x + width / 2
    cy = y + height / 2
    return f"{class_id} {cx:.6f} {cy:.6f} {width:.6f} {height:.6f}"


def rect_iou(left: list[float], right: list[float]) -> float:
    ax, ay, aw, ah = left
    bx, by, bw, bh = right
    x1 = max(ax, bx)
    y1 = max(ay, by)
    x2 = min(ax + aw, bx + bw)
    y2 = min(ay + ah, by + bh)
    inter = max(0.0, x2 - x1) * max(0.0, y2 - y1)
    union = aw * ah + bw * bh - inter
    return inter / union if union > 0 else 0.0


def slot_index(value: float, start: float, size: float, count: int) -> int:
    if size <= 0:
        return 0
    return max(0, min(count - 1, int((value - start) / size * count)))


def snap_box_to_slot(center_box: list[float], recording_id: str, profile) -> tuple[str, list[float]] | tuple[None, None]:
    cx, cy, width, height = center_box
    regions = profile["draft_regions"]
    ban_count = RECORDING_BAN_SLOTS.get(recording_id, profile["ban_slots"])

    if cy <= 0.18:
        class_name = "ally_ban_slot" if cx < 0.5 else "enemy_ban_slot"
        region = regions["ally_ban_rail" if class_name == "ally_ban_slot" else "enemy_ban_rail"]
        rails = draft_slot_rects(recording_id, profile)[class_name]
        index = slot_index(cx, region[0], region[2], ban_count)
        return class_name, rails[index]

    if cx <= 0.36:
        class_name = "ally_pick_slot"
        rails = draft_slot_rects(recording_id, profile)[class_name]
        region = regions["ally_pick_rail"]
        index = slot_index(cy, region[1], region[3], 5)
        return class_name, rails[index]

    if cx >= 0.64:
        class_name = "enemy_pick_slot"
        rails = draft_slot_rects(recording_id, profile)[class_name]
        region = regions["enemy_pick_rail"]
        index = slot_index(cy, region[1], region[3], 5)
        return class_name, rails[index]

    return None, None


def build_draft_label_lines(recording_id: str, profile, *, finalized: bool = False) -> list[str]:
    slots = draft_slot_rects(recording_id, profile)
    lines = [xywh_to_yolo(CLASS_IDS["draft_screen"], slots["draft_screen"][0])]
    for class_name in ("ally_pick_slot", "enemy_pick_slot", "ally_ban_slot", "enemy_ban_slot"):
        class_id = CLASS_IDS[class_name]
        for rect in slots[class_name]:
            lines.append(xywh_to_yolo(class_id, rect))
    if finalized:
        if recording_id == "legend":
            lines.append(xywh_to_yolo(8, [0.052, 0.09 + 0.16645 * 3, 0.045, 0.1]))
        else:
            lines.append(xywh_to_yolo(8, [0.015, 0.485, 0.036, 0.045]))
        for slot in range(1, 6):
            lines.append(xywh_to_yolo(9, [0.106, 0.109 + 0.16645 * (slot - 1), 0.026, 0.058]))
    return lines


def relabel_yolo_lines(
    lines: list[str],
    width: int,
    height: int,
    recording_id: str = "mythic",
    *,
    snap_draft: bool = True,
) -> list[str]:
    profile = select_profile(width, height)
    output: list[str] = []
    seen: set[str] = set()

    for line in lines:
        parsed = yolo_to_xywh(line)
        if not parsed:
            continue
        class_id, rect = parsed
        if class_id not in ANCHOR_CLASS_IDS:
            continue

        if snap_draft and class_id in DRAFT_SLOT_CLASSES:
            if class_id == 1:
                output.append(xywh_to_yolo(1, draft_slot_rects(recording_id, profile)["draft_screen"][0]))
                continue
            center = [rect[0] + rect[2] / 2, rect[1] + rect[3] / 2, rect[2], rect[3]]
            class_name, snapped = snap_box_to_slot(center, recording_id, profile)
            if class_name:
                rect = snapped
                class_id = CLASS_IDS[class_name]
            dedupe = f"{class_id}:{rect[0]:.4f}:{rect[1]:.4f}"
            if dedupe in seen:
                continue
            seen.add(dedupe)
            output.append(xywh_to_yolo(class_id, rect))
            continue

        dedupe = f"{class_id}:{rect[0]:.4f}:{rect[1]:.4f}:{rect[2]:.4f}:{rect[3]:.4f}"
        if dedupe in seen:
            continue
        seen.add(dedupe)
        output.append(xywh_to_yolo(class_id, rect))

    draft_slots = [line for line in output if line.startswith(("4 ", "5 ", "6 ", "7 "))]
    if snap_draft and len(draft_slots) >= 6 and "1 " not in output:
        output.insert(0, xywh_to_yolo(1, [0.0, 0.0, 1.0, 1.0]))

    return output


def roboflow_profile_allowed(profile: str | None) -> bool:
    if not profile:
        return True
    if profile in ROBOFLOW_EXCLUDE_PROFILES:
        return False
    if profile in ROBOFLOW_INCLUDE_PROFILES:
        return True
    return profile not in ROBOFLOW_EXCLUDE_PROFILES


def draft_slot_coverage(lines: list[str], recording_id: str, profile) -> dict[str, float]:
    expected = draft_slot_rects(recording_id, profile)
    parsed = []
    for line in lines:
        item = yolo_to_xywh(line)
        if item:
            parsed.append(item)
    scores = {}
    for class_name, rects in expected.items():
        if class_name == "draft_screen":
            continue
        class_id = CLASS_IDS[class_name]
        best_scores = []
        for expected_rect in rects:
            matches = [rect for cid, rect in parsed if cid == class_id]
            best = max((rect_iou(expected_rect, rect) for rect in matches), default=0.0)
            best_scores.append(best)
        scores[class_name] = sum(best_scores) / len(best_scores) if best_scores else 0.0
    return scores


def transform_labels_for_resize(
    lines: list[str],
    source_width: int,
    source_height: int,
    target_width: int,
    target_height: int,
) -> list[str]:
    from_aspect = source_width / max(source_height, 1)
    to_aspect = target_width / max(target_height, 1)
    if abs(from_aspect - to_aspect) < 0.02:
        return lines
    output = []
    for line in lines:
        parsed = yolo_to_xywh(line)
        if not parsed:
            continue
        class_id, rect = parsed
        rect = stretch_normalized_rect(rect, from_aspect, to_aspect)
        output.append(xywh_to_yolo(class_id, rect))
    return output


def _self_test() -> None:
    lines = [
        "4 0.080000 0.515599 0.160000 0.160000",
        "4 0.080000 0.356959 0.160000 0.160000",
    ]
    aligned = relabel_yolo_lines(lines, 2856, 1280, "mythic")
    assert any(line.startswith("4 ") for line in aligned)
    assert not roboflow_profile_allowed("camera-objectives")
    assert roboflow_profile_allowed("draft-slots")
    print('{"ok": true}')


if __name__ == "__main__":
    if "--test" in sys.argv:
        _self_test()
