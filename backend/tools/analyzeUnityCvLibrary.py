import argparse
import json
import re
import time
from collections import Counter, defaultdict
from pathlib import Path

import UnityPy


SURFACES = {
    "draft": re.compile(r"(choosehero|chooselane|banlist|bpban|pick|heroselect|heropick)", re.I),
    "hero_heads": re.compile(r"(hero[_-]?head|herohead|headicon|oneheroicon|headcutting|headpanel|headshow|heroicon)", re.I),
    "skin_heads": re.compile(r"(skinhead|skin[_-]?head|newrankingbuyskin|buyskin)", re.I),
    "lanes_roles": re.compile(r"(chooselane|lane|road|position|role)", re.I),
    "battle_spells": re.compile(r"(skillicon|battlespell|spell|summon|talent|retribution|purify|flicker|inspire|sprint)", re.I),
    "minimap": re.compile(r"(minimap|smallmap|battlemap)", re.I),
    "objectives": re.compile(r"(lord|turtle|goldenturtle|creep|monster|turret|tower|buff)", re.I),
    "live_hud": re.compile(r"(battleinfo|headinfo|battlesetup|battlemessage|battlechat|battlepickup|inbattle|battlehud)", re.I),
    "shop_builds": re.compile(r"(battleshop|battleplan|recequip|pickupequip|equipicon|equipment|itemicon)", re.I),
    "score_results": re.compile(r"(battleperformance|battledata|battleresult|scoreboard|statistics|settlement|result)", re.I),
    "loading": re.compile(r"(battleloading|scenesloading|guideloading|loading)", re.I),
    "lobby_rank": re.compile(r"(matchroom|choosemode|matching|ranking|rankmode|ranked|lobby)", re.I),
    "map_scene": re.compile(r"(battleground|battlefield|map|scene)", re.I),
    "status_recall": re.compile(r"(deathreplay|battledeath|reconnect|recall|revive|status)", re.I),
}

SKIN_ART = re.compile(r"(skin\d*|cityaction|cityacion|recall|spawn|elimination|trail|killfx)", re.I)
DEEP_FAMILIES = {"UI", "TextAsset", "Document", "img", "Scenes", "AstcInPack"}
TEXTURE_TYPES = {"Texture2D", "Sprite"}


def relative_parts(path: Path, root: Path) -> tuple[str, str]:
    relative = path.relative_to(root).as_posix()
    family = "other"
    marker = "/assets/"
    if marker in f"/{relative}":
        after = f"/{relative}".split(marker, 1)[1]
        family = after.split("/", 1)[0]
    return relative, family


def matched_surfaces(value: str) -> list[str]:
    return [name for name, matcher in SURFACES.items() if matcher.search(value)]


def should_deep_read(relative: str, family: str, file_surfaces: list[str]) -> bool:
    if family in DEEP_FAMILIES:
        return True
    if file_surfaces and not (file_surfaces == ["map_scene"] and SKIN_ART.search(relative)):
        return True
    return False


def analyze_bundle(path: Path, root: Path, relative: str, family: str, file_surfaces: list[str]) -> dict:
    entry = {
        "file": relative,
        "family": family,
        "bytes": path.stat().st_size,
        "fileSurfaces": file_surfaces,
        "contentSurfaces": [],
        "objects": {},
        "textures": [],
        "error": None,
    }
    try:
        env = UnityPy.load(str(path))
        content_surfaces: set[str] = set()
        objects = Counter()
        textures = []
        for obj in env.objects:
            type_name = obj.type.name
            objects[type_name] += 1
            if type_name not in TEXTURE_TYPES:
                continue
            data = obj.read()
            name = str(getattr(data, "m_Name", type_name))
            surfaces = matched_surfaces(name)
            content_surfaces.update(surfaces)
            if surfaces or file_surfaces:
                image = getattr(data, "image", None)
                textures.append({
                    "name": name,
                    "kind": type_name,
                    "width": int(getattr(image, "width", 0) or 0),
                    "height": int(getattr(image, "height", 0) or 0),
                    "surfaces": surfaces,
                })
        entry["objects"] = dict(objects)
        entry["contentSurfaces"] = sorted(content_surfaces)
        entry["textures"] = textures
    except Exception as error:
        entry["error"] = str(error)
    return entry


def main() -> int:
    parser = argparse.ArgumentParser(description="Index MLBB Unity bundles for CV and reference-library surfaces.")
    parser.add_argument("source_root", type=Path)
    parser.add_argument("output_json", type=Path)
    args = parser.parse_args()
    root = args.source_root.resolve()
    started = time.time()
    unity_files = sorted(root.rglob("*.unity3d"))
    family_counts: Counter[str] = Counter()
    family_bytes: Counter[str] = Counter()
    file_surface_counts: Counter[str] = Counter()
    skin_art_counts: Counter[str] = Counter()
    deep_candidates = []
    file_examples: defaultdict[str, list[str]] = defaultdict(list)
    for path in unity_files:
        relative, family = relative_parts(path, root)
        byte_count = path.stat().st_size
        family_counts[family] += 1
        family_bytes[family] += byte_count
        surfaces = matched_surfaces(relative)
        for surface in surfaces:
            file_surface_counts[surface] += 1
            if len(file_examples[surface]) < 8:
                file_examples[surface].append(relative)
        if family == "Art" and SKIN_ART.search(relative):
            skin_art_counts["bundles"] += 1
            skin_art_counts["bytes"] += byte_count
        if should_deep_read(relative, family, surfaces):
            deep_candidates.append((path, relative, family, surfaces))
    inspected = []
    content_surface_counts: Counter[str] = Counter()
    useful_texture_counts: Counter[str] = Counter()
    errors = 0
    for path, relative, family, surfaces in deep_candidates:
        entry = analyze_bundle(path, root, relative, family, surfaces)
        if entry["error"]:
            errors += 1
        merged_surfaces = sorted(set(entry["fileSurfaces"] + entry["contentSurfaces"]))
        entry["surfaces"] = merged_surfaces
        for surface in entry["contentSurfaces"]:
            content_surface_counts[surface] += 1
        for texture in entry["textures"]:
            for surface in sorted(set(texture["surfaces"] + surfaces)):
                useful_texture_counts[surface] += 1
        if merged_surfaces or entry["textures"]:
            inspected.append(entry)
    useful_by_surface = {}
    for surface in SURFACES:
        useful_by_surface[surface] = {
            "bundlesNamed": file_surface_counts[surface],
            "bundlesFoundInContent": content_surface_counts[surface],
            "candidateTextures": useful_texture_counts[surface],
            "examples": file_examples[surface],
        }
    output = {
        "createdAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "sourceRoot": str(root),
        "elapsedSeconds": round(time.time() - started, 2),
        "inventory": {
            "unityBundles": len(unity_files),
            "bytes": sum(family_bytes.values()),
            "families": [
                {"family": family, "bundles": count, "bytes": family_bytes[family]}
                for family, count in family_counts.most_common()
            ],
            "skinEffectArt": {
                "bundles": skin_art_counts["bundles"],
                "bytes": skin_art_counts["bytes"],
                "note": "Useful for visual library/effect research, generally not stable CV templates.",
            },
        },
        "deepInspection": {
            "bundlesRead": len(deep_candidates),
            "usefulBundles": len(inspected),
            "errors": errors,
            "strategy": "All UI/TextAsset/Document/img/Scenes/AstcInPack bundles plus semantically named Art bundles were object-inspected; remaining Art bundles were fully filename-inventoried.",
        },
        "surfaces": useful_by_surface,
        "usefulBundles": inspected,
    }
    args.output_json.parent.mkdir(parents=True, exist_ok=True)
    args.output_json.write_text(json.dumps(output, indent=2), encoding="utf-8")
    print(json.dumps({
        "unityBundles": len(unity_files),
        "deepBundles": len(deep_candidates),
        "usefulBundles": len(inspected),
        "errors": errors,
        "elapsedSeconds": output["elapsedSeconds"],
        "output": str(args.output_json),
        "surfaces": {
            surface: {
                "bundlesNamed": details["bundlesNamed"],
                "bundlesFoundInContent": details["bundlesFoundInContent"],
                "candidateTextures": details["candidateTextures"],
            }
            for surface, details in useful_by_surface.items()
        },
    }))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
