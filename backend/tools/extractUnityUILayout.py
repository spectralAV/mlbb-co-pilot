"""
Extract MLBB draft UI layout from synced Unity UI bundles (NGUI Transform + widget typetrees).

Usage:
  python backend/tools/extractUnityUILayout.py SOURCE_ROOT OUTPUT_JSON [--scope draft] [--max-bundles N]
"""

from __future__ import annotations

import argparse
import json
import math
import re
import time
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any

import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))

import UnityPy

from mlbbUiTaxonomy import bundle_screen, draft_ui_states, tag_node

SCOPE_PATTERNS: dict[str, re.Pattern[str]] = {
    "draft": re.compile(r"(ChooseHero|ChooseLane|BanList|BPBan|BP_|_BP)", re.I),
    "hud": re.compile(r"(BattleInfo|HeadInfo|HeadPanel|BattleSetup|BattleMessage|BattleChat|BattlePickup|BattleShop|BattlePlan|MiniMap)", re.I),
    "loading": re.compile(r"(BattleLoading|ScenesLoading|GuideLoading|ArenaLoading)", re.I),
    "lobby": re.compile(r"(MatchRoom|ChooseMode|Matching|Ranking|RankMode)", re.I),
    "scoreboard": re.compile(r"(BattlePerformance|BattleData|BattleResult|Scoreboard|Statistics|Settlement)", re.I),
}


def clamp01(value: float) -> float:
    if not math.isfinite(value):
        return 0.0
    return max(0.0, min(1.0, value))


def vec3_xy(vector: Any) -> tuple[float, float]:
    if vector is None:
        return 0.0, 0.0
    return float(getattr(vector, "x", 0) or 0), float(getattr(vector, "y", 0) or 0)


def world_xy(transform_obj: Any, cache: dict[int, tuple[float, float]]) -> tuple[float, float]:
    path_id = transform_obj.path_id
    if path_id in cache:
        return cache[path_id]
    data = transform_obj.read()
    local_x, local_y = vec3_xy(data.m_LocalPosition)
    father = data.m_Father
    if father and father.path_id not in (0, None):
        try:
            parent_x, parent_y = world_xy(father, cache)
            local_x += parent_x
            local_y += parent_y
        except Exception:
            pass
    cache[path_id] = (local_x, local_y)
    return local_x, local_y


def hierarchy_path(transform_obj: Any, cache: dict[int, str]) -> str:
    path_id = transform_obj.path_id
    if path_id in cache:
        return cache[path_id]
    data = transform_obj.read()
    try:
        name = data.m_GameObject.read().m_Name
    except Exception:
        name = "?"
    father = data.m_Father
    if father and father.path_id not in (0, None):
        try:
            parent_path = hierarchy_path(father, cache)
            full = f"{parent_path}/{name}" if parent_path else name
        except Exception:
            full = name
    else:
        full = name
    cache[path_id] = full
    return full


def ngui_widget_rect(
    tree: dict[str, Any],
    world_x: float,
    world_y: float,
    ref_w: float,
    ref_h: float,
) -> list[float] | None:
    width = tree.get("mWidth")
    height = tree.get("mHeight")
    if not isinstance(width, (int, float)) or not isinstance(height, (int, float)):
        return None
    if width <= 0 or height <= 0 or ref_w <= 0 or ref_h <= 0:
        return None
    w = float(width)
    h = float(height)
    pivot = tree.get("mPivot")
    pivot_x = float(getattr(pivot, "x", 0.5) or 0.5) if pivot is not None else 0.5
    pivot_y = float(getattr(pivot, "y", 0.5) or 0.5) if pivot is not None else 0.5
    left = world_x - w * pivot_x
    bottom = world_y - h * pivot_y
    return [
        round(clamp01(left / ref_w), 6),
        round(clamp01(1 - (bottom + h) / ref_h), 6),
        round(clamp01(w / ref_w), 6),
        round(clamp01(h / ref_h), 6),
    ]


def estimated_widget_for_node(name: str, tags: list[str]) -> dict[str, Any] | None:
    if re.match(r"^Hero\d+$", name, re.I):
        return {"widgetType": "ngui-estimate", "mWidth": 250, "mHeight": 252, "mSpriteName": None}
    if re.search(r"banhero|sprite_ban", name, re.I) or "ban_slot" in tags:
        return {"widgetType": "ngui-estimate", "mWidth": 96, "mHeight": 96, "mSpriteName": None}
    if "lane" in tags:
        return {"widgetType": "ngui-estimate", "mWidth": 48, "mHeight": 48, "mSpriteName": None}
    if "battle_spell" in tags or re.search(r"skill|spell", name, re.I):
        return {"widgetType": "ngui-estimate", "mWidth": 64, "mHeight": 64, "mSpriteName": None}
    return None


def infer_reference_resolution(panel_sizes: list[tuple[float, float]]) -> dict[str, float]:
    if not panel_sizes:
        return {"width": 2400, "height": 1080, "source": "default"}
    ranked = sorted(panel_sizes, key=lambda item: item[0] * item[1], reverse=True)
    width, height = ranked[0]
    if width >= height * 1.5:
        return {"width": width, "height": height, "source": "largest-ngui-panel"}
    for w, h in ranked:
        if w >= 1000 and 0.4 <= h / w <= 0.6:
            return {"width": w, "height": h, "source": "aspect-matched-panel"}
    return {"width": width, "height": height, "source": "largest-ngui-panel"}


def extract_bundle_layout(bundle_path: Path, root: Path) -> dict[str, Any]:
    relative = bundle_path.relative_to(root).as_posix()
    entry: dict[str, Any] = {
        "bundle": relative,
        "screen": bundle_screen(relative),
        "error": None,
        "referenceResolution": None,
        "draftUiStates": [],
        "objectCounts": {},
        "nodes": [],
    }
    try:
        env = UnityPy.load(str(bundle_path))
    except Exception as error:
        entry["error"] = str(error)
        return entry

    counts = Counter(obj.type.name for obj in env.objects)
    entry["objectCounts"] = dict(counts)

    transforms = [obj for obj in env.objects if obj.type.name == "Transform"]
    transform_by_go: dict[int, Any] = {}
    for transform in transforms:
        try:
            transform_by_go[transform.read().m_GameObject.path_id] = transform
        except Exception:
            continue
    world_cache: dict[int, tuple[float, float]] = {}
    path_cache: dict[int, str] = {}
    ancestor_widget_cache: dict[int, dict[str, Any] | None] = {}
    children_by_go: dict[int, list[int]] = defaultdict(list)
    for transform in transforms:
        try:
            child_go_id = transform.read().m_GameObject.path_id
            father = transform.read().m_Father
            if father and father.path_id not in (0, None):
                parent_go_id = father.read().m_GameObject.path_id
                children_by_go[parent_go_id].append(child_go_id)
        except Exception:
            continue

    panel_sizes: list[tuple[float, float]] = []
    widgets_by_go: dict[int, dict[str, Any]] = {}

    for obj in env.objects:
        if obj.type.name != "MonoBehaviour":
            continue
        try:
            tree = obj.read_typetree()
        except Exception:
            continue
        width = tree.get("mWidth")
        height = tree.get("mHeight")
        if isinstance(width, (int, float)) and isinstance(height, (int, float)) and width > 200 and height > 200:
            panel_sizes.append((float(width), float(height)))
        go_ptr = tree.get("m_GameObject")
        if go_ptr is None:
            continue
        if isinstance(go_ptr, dict):
            go_id = go_ptr.get("m_PathID") or go_ptr.get("path_id")
        else:
            go_id = getattr(go_ptr, "path_id", None)
        if go_id is None:
            continue
        go_id = int(go_id)
        if not isinstance(width, (int, float)) or not isinstance(height, (int, float)) or width <= 0 or height <= 0:
            continue
        sprite = tree.get("mSpriteName") or tree.get("spriteName")
        widgets_by_go[go_id] = {
            "widgetType": "ngui",
            "mWidth": float(width),
            "mHeight": float(height),
            "mSpriteName": str(sprite) if sprite else None,
            "mDepth": tree.get("mDepth"),
            "anchors": {
                key: tree.get(key)
                for key in ("leftAnchor", "rightAnchor", "topAnchor", "bottomAnchor")
                if key in tree
            },
        }

    reference = infer_reference_resolution(panel_sizes)
    entry["referenceResolution"] = reference
    ref_w = float(reference["width"])
    ref_h = float(reference["height"])

    def resolve_widget(go_path_id: int) -> dict[str, Any] | None:
        if go_path_id in ancestor_widget_cache:
            return ancestor_widget_cache[go_path_id]
        direct = widgets_by_go.get(go_path_id)
        if direct:
            ancestor_widget_cache[go_path_id] = direct
            return direct
        transform = transform_by_go.get(go_path_id)
        if transform is not None:
            father = transform.read().m_Father
            if father and father.path_id not in (0, None):
                try:
                    parent_go_id = father.read().m_GameObject.path_id
                    inherited = resolve_widget(parent_go_id)
                    if inherited:
                        ancestor_widget_cache[go_path_id] = inherited
                        return inherited
                except Exception:
                    pass
        queue = list(children_by_go.get(go_path_id, []))
        visited = {go_path_id}
        while queue:
            child_go_id = queue.pop(0)
            if child_go_id in visited:
                continue
            visited.add(child_go_id)
            child_widget = widgets_by_go.get(child_go_id)
            if child_widget:
                ancestor_widget_cache[go_path_id] = child_widget
                return child_widget
            queue.extend(children_by_go.get(child_go_id, []))
        ancestor_widget_cache[go_path_id] = None
        return None

    nodes = []
    for transform in transforms:
        try:
            game_object = transform.read().m_GameObject.read()
        except Exception:
            continue
        name = str(game_object.m_Name or "")
        if not name or name.startswith(" "):
            continue
        path = hierarchy_path(transform, path_cache)
        world_x, world_y = world_xy(transform, world_cache)
        try:
            go_path_id = transform.read().m_GameObject.path_id
        except Exception:
            continue
        tagged = tag_node(name, path, bundle=relative, world_x=world_x, ref_w=ref_w)
        tags = tagged["semanticTags"]
        widget = resolve_widget(go_path_id)
        if not widget or not widget.get("mWidth") or not widget.get("mHeight"):
            widget = estimated_widget_for_node(name, tags) or widget
        rect = None
        if widget:
            rect = ngui_widget_rect(
                {"mWidth": widget.get("mWidth"), "mHeight": widget.get("mHeight"), "mPivot": None},
                world_x,
                world_y,
                ref_w,
                ref_h,
            )
        if rect is None and widget and widget.get("mWidth") and widget.get("mHeight"):
            w = float(widget["mWidth"])
            h = float(widget["mHeight"])
            rect = [
                round(clamp01(world_x / ref_w), 6),
                round(clamp01(1 - (world_y + h) / ref_h), 6),
                round(clamp01(w / ref_w), 6),
                round(clamp01(h / ref_h), 6),
            ]
        if not tags and not widget and not re.search(r"hero|ban|lane|spell|bp|pick", name, re.I):
            continue
        nodes.append({
            "name": name,
            "path": path,
            "active": bool(getattr(game_object, "m_IsActive", True)),
            "world": {"x": round(world_x, 3), "y": round(world_y, 3)},
            "normalizedRect": rect,
            "semanticTags": tags,
            "elementKind": tagged["elementKind"],
            "copilotClassHint": tagged["copilotClassHint"],
            "widget": widget,
        })

    entry["nodes"] = sorted(nodes, key=lambda node: node["path"])
    entry["draftUiStates"] = draft_ui_states([node["name"] for node in nodes], relative)
    return entry


def select_bundles(root: Path, scope: str, max_bundles: int | None) -> list[Path]:
    all_bundles = sorted(root.rglob("*.unity3d"))
    if scope == "all":
        selected = all_bundles
    elif scope == "game-ui":
        combined = re.compile(
            "|".join(pattern.pattern for pattern in SCOPE_PATTERNS.values()),
            re.I,
        )
        selected = [path for path in all_bundles if combined.search(path.as_posix())]
    else:
        pattern = SCOPE_PATTERNS.get(scope)
        selected = [path for path in all_bundles if pattern and pattern.search(path.as_posix())]
    if max_bundles is not None and max_bundles > 0:
        selected = selected[:max_bundles]
    return selected


def main() -> int:
    parser = argparse.ArgumentParser(description="Extract MLBB NGUI/UI layout graph from Unity bundles.")
    parser.add_argument("source_root", type=Path, help="Synced UI root, e.g. data/adb-assets/library/UI/android")
    parser.add_argument("output_json", type=Path, help="Output layout graph JSON path")
    parser.add_argument(
        "--scope",
        choices=("draft", "hud", "loading", "lobby", "scoreboard", "game-ui", "all"),
        default="game-ui",
    )
    parser.add_argument("--max-bundles", type=int, default=0, help="Limit bundles (0 = no limit)")
    args = parser.parse_args()

    root = args.source_root.resolve()
    if not root.exists():
        print(json.dumps({"error": f"Source root not found: {root}"}))
        return 2

    max_bundles = args.max_bundles if args.max_bundles > 0 else None
    bundles = select_bundles(root, args.scope, max_bundles)
    started = time.time()
    layouts = []
    errors = 0
    for bundle_path in bundles:
        entry = extract_bundle_layout(bundle_path, root)
        if entry["error"]:
            errors += 1
        if entry["nodes"]:
            layouts.append(entry)

    graph = {
        "createdAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "sourceRoot": str(root),
        "scope": args.scope,
        "engine": "UnityPy+NGUI",
        "taxonomy": "mlbbUiTaxonomy",
        "elapsedSeconds": round(time.time() - started, 2),
        "inventory": {
            "bundlesScanned": len(bundles),
            "bundlesWithNodes": len(layouts),
            "errors": errors,
            "totalNodes": sum(len(entry["nodes"]) for entry in layouts),
        },
        "bundles": layouts,
    }

    args.output_json.parent.mkdir(parents=True, exist_ok=True)
    args.output_json.write_text(json.dumps(graph, indent=2, default=str), encoding="utf-8")
    print(json.dumps({
        "bundlesScanned": len(bundles),
        "bundlesWithNodes": len(layouts),
        "errors": errors,
        "totalNodes": graph["inventory"]["totalNodes"],
        "elapsedSeconds": graph["elapsedSeconds"],
        "output": str(args.output_json.resolve()),
    }))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
