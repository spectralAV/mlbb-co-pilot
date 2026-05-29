import json
import re
import sys
from pathlib import Path

import UnityPy


def safe_name(value: str) -> str:
    cleaned = re.sub(r"[^A-Za-z0-9._-]+", "_", value).strip("._")
    return cleaned or "texture"


def main() -> int:
    if len(sys.argv) != 3:
        print(json.dumps({"error": "Usage: extractUnityTextures.py SOURCE_DIR OUTPUT_DIR"}))
        return 2
    source_dir = Path(sys.argv[1])
    output_dir = Path(sys.argv[2])
    output_dir.mkdir(parents=True, exist_ok=True)
    bundles = []
    for path in sorted(source_dir.rglob("*.unity3d")):
        bundle_output = output_dir / path.relative_to(source_dir).with_suffix("")
        result = {
            "bundle": path.relative_to(source_dir).as_posix(),
            "objects": {},
            "textures": [],
            "atlasSprites": [],
            "error": None,
        }
        try:
            env = UnityPy.load(str(path))
            bundle_output.mkdir(parents=True, exist_ok=True)
            used_names = set()
            source_images = []
            atlas_entries = []
            for obj in env.objects:
                type_name = obj.type.name
                result["objects"][type_name] = result["objects"].get(type_name, 0) + 1
                if type_name == "MonoBehaviour":
                    try:
                        tree = obj.read_typetree()
                        atlas_entries.extend(tree.get("mSprites", []))
                    except Exception:
                        pass
                    continue
                if type_name not in ("Texture2D", "Sprite"):
                    continue
                data = obj.read()
                image = getattr(data, "image", None)
                if image is None:
                    continue
                base = safe_name(getattr(data, "m_Name", type_name))
                if type_name == "Texture2D":
                    source_images.append((base, image))
                name = base
                suffix = 2
                while name.lower() in used_names:
                    name = f"{base}-{suffix}"
                    suffix += 1
                used_names.add(name.lower())
                output_path = bundle_output / f"{name}.png"
                image.save(output_path)
                result["textures"].append({
                    "name": getattr(data, "m_Name", name),
                    "kind": type_name,
                    "file": output_path.relative_to(output_dir).as_posix(),
                    "width": image.width,
                    "height": image.height,
                })
            atlas_source = next((image for name, image in source_images if name.lower().endswith("_main")), None)
            if atlas_source is None and len(source_images) == 1:
                atlas_source = source_images[0][1]
            if atlas_source is not None and atlas_entries:
                sprite_output = bundle_output / "sprites"
                sprite_output.mkdir(parents=True, exist_ok=True)
                sprite_names = set()
                for sprite in atlas_entries:
                    base = safe_name(str(sprite.get("name", "sprite")))
                    name = base
                    suffix = 2
                    while name.lower() in sprite_names:
                        name = f"{base}-{suffix}"
                        suffix += 1
                    sprite_names.add(name.lower())
                    x = int(sprite.get("x", 0))
                    y = int(sprite.get("y", 0))
                    width = int(sprite.get("width", 0))
                    height = int(sprite.get("height", 0))
                    if width <= 0 or height <= 0:
                        continue
                    crop = atlas_source.crop((x, y, x + width, y + height))
                    output_path = sprite_output / f"{name}.png"
                    crop.save(output_path)
                    entry = {
                        "name": str(sprite.get("name", name)),
                        "kind": "AtlasSprite",
                        "file": output_path.relative_to(output_dir).as_posix(),
                        "width": width,
                        "height": height,
                    }
                    result["atlasSprites"].append(entry)
                    result["textures"].append(entry)
        except Exception as error:
            result["error"] = str(error)
        bundles.append(result)
    print(json.dumps({"bundles": bundles}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
