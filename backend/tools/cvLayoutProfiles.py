"""
Normalized UI layout profiles for YOLO anchor training and label alignment.

Runtime draft rails in frontend/src/vision/draftIconDetector.ts match phone_20_9.
"""

from __future__ import annotations

import math
from typing import TypedDict


class LayoutProfile(TypedDict):
    id: str
    label: str
    aspect_ratio: float
    width: int
    height: int
    draft_regions: dict[str, list[float]]
    ban_slots: int
    minimap_panel: list[float]
    scoreboard_region: list[float]


def split_vertical(rect: list[float], count: int) -> list[list[float]]:
    x, y, width, height = rect
    part_height = height / count
    return [[x, y + part_height * index, width, part_height] for index in range(count)]


def split_horizontal(rect: list[float], count: int) -> list[list[float]]:
    x, y, width, height = rect
    part_width = width / count
    return [[x + part_width * index, y, part_width, height] for index in range(count)]


# phone_20_9 — Pixel / mythic&legend reviewed captures (2856×1280)
PHONE_20_9_DRAFT = {
    "ally_pick_rail": [0.0, 0.083042, 0.162621, 0.832224],
    "enemy_pick_rail": [0.842233, 0.084847, 0.157767, 0.828613],
    "ally_ban_rail": [0.035599, 0.0, 0.224919, 0.086652],
    "enemy_ban_rail": [0.737055, 0.0, 0.222492, 0.088458],
}

# video_16_9 — synthetic minimap + emulator-style 1920×1080 (rails slightly wider)
VIDEO_16_9_DRAFT = {
    "ally_pick_rail": [0.0, 0.088, 0.175, 0.824],
    "enemy_pick_rail": [0.825, 0.088, 0.175, 0.824],
    "ally_ban_rail": [0.03, 0.0, 0.23, 0.092],
    "enemy_ban_rail": [0.74, 0.0, 0.23, 0.092],
}

# ultrawide_2_1 — 1800×900 style local captures (Roboflow weak labels target this grid)
ULTRAWIDE_2_1_DRAFT = {
    "ally_pick_rail": [0.0, 0.1, 0.18, 0.8],
    "enemy_pick_rail": [0.82, 0.1, 0.18, 0.8],
    "ally_ban_rail": [0.02, 0.0, 0.24, 0.1],
    "enemy_ban_rail": [0.74, 0.0, 0.24, 0.1],
}

LAYOUT_PROFILES: list[LayoutProfile] = [
    {
        "id": "phone_20_9",
        "label": "20:9 phone",
        "aspect_ratio": 20 / 9,
        "width": 2856,
        "height": 1280,
        "draft_regions": PHONE_20_9_DRAFT,
        "ban_slots": 5,
        "minimap_panel": [0.028361, 0.0, 0.140756, 0.314063],
        "scoreboard_region": [0.1, 0.13, 0.8, 0.78],
    },
    {
        "id": "video_16_9",
        "label": "16:9 video",
        "aspect_ratio": 16 / 9,
        "width": 1920,
        "height": 1080,
        "draft_regions": VIDEO_16_9_DRAFT,
        "ban_slots": 5,
        "minimap_panel": [0.028361, 0.0, 0.140756, 0.314063],
        "scoreboard_region": [0.1, 0.13, 0.8, 0.78],
    },
    {
        "id": "ultrawide_2_1",
        "label": "2:1 ultrawide",
        "aspect_ratio": 2.0,
        "width": 1800,
        "height": 900,
        "draft_regions": ULTRAWIDE_2_1_DRAFT,
        "ban_slots": 5,
        "minimap_panel": [0.03, 0.0, 0.15, 0.32],
        "scoreboard_region": [0.1, 0.13, 0.8, 0.78],
    },
]

PROFILE_BY_ID = {profile["id"]: profile for profile in LAYOUT_PROFILES}

RECORDING_BAN_SLOTS = {"legend": 4, "mythic": 5}


def select_profile(width: int, height: int) -> LayoutProfile:
    if width <= 0 or height <= 0:
        return PROFILE_BY_ID["phone_20_9"]
    aspect = width / height
    nearest = min(
        LAYOUT_PROFILES,
        key=lambda profile: abs(profile["aspect_ratio"] - aspect) / profile["aspect_ratio"],
    )
    distance = abs(nearest["aspect_ratio"] - aspect) / nearest["aspect_ratio"]
    if distance > 0.12:
        return PROFILE_BY_ID["phone_20_9"]
    return nearest


def draft_slot_rects(recording_id: str, profile: LayoutProfile) -> dict[str, list[list[float]]]:
    regions = profile["draft_regions"]
    ban_count = RECORDING_BAN_SLOTS.get(recording_id, profile["ban_slots"])
    return {
        "draft_screen": [[0.0, 0.0, 1.0, 1.0]],
        "ally_pick_slot": split_vertical(regions["ally_pick_rail"], 5),
        "enemy_pick_slot": split_vertical(regions["enemy_pick_rail"], 5),
        "ally_ban_slot": split_horizontal(regions["ally_ban_rail"], ban_count),
        "enemy_ban_slot": split_horizontal(regions["enemy_ban_rail"], ban_count),
    }


def stretch_normalized_rect(rect: list[float], from_aspect: float, to_aspect: float) -> list[float]:
    """Map normalized xywh when the image is stretched from one aspect to another (fill resize)."""
    x, y, width, height = rect
    scale_x = from_aspect / to_aspect
    scale_y = 1.0
    x2 = x * scale_x
    width2 = width * scale_x
    if x2 + width2 > 1.0:
        overflow = x2 + width2 - 1.0
        x2 = max(0.0, x2 - overflow / 2)
        width2 = min(width2, 1.0 - x2)
    return [max(0.0, x2), max(0.0, y * scale_y), min(1.0, width2), min(1.0, height * scale_y)]


def _self_test() -> None:
    profile = select_profile(2856, 1280)
    assert profile["id"] == "phone_20_9"
    slots = draft_slot_rects("mythic", profile)
    assert len(slots["ally_pick_slot"]) == 5
    assert len(slots["ally_ban_slot"]) == 5
    legend = draft_slot_rects("legend", profile)
    assert len(legend["ally_ban_slot"]) == 4
    stretched = stretch_normalized_rect([0.08, 0.1, 0.16, 0.8], 20 / 9, 16 / 9)
    assert all(0 <= value <= 1 for value in stretched)
    print('{"ok": true, "profiles": %d}' % len(LAYOUT_PROFILES))


if __name__ == "__main__":
    import sys

    if "--test" in sys.argv:
        _self_test()
    else:
        import json

        print(json.dumps({"profiles": LAYOUT_PROFILES}, indent=2))
