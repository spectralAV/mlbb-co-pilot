import argparse
import importlib.util
import json
from pathlib import Path


MODEL_NAME = "dinov2_vits14"


def status(_project_root: Path):
    return {
        "engine": "dinov2-reference-matching",
        "model": MODEL_NAME,
        "torchAvailable": importlib.util.find_spec("torch") is not None,
        "torchvisionAvailable": importlib.util.find_spec("torchvision") is not None,
        "purpose": ["draft-hero-identity", "live-minimap-hero-identity"],
    }


def load_model():
    import torch
    from torchvision import transforms

    model = torch.hub.load("facebookresearch/dinov2", MODEL_NAME, trust_repo=True)
    model.eval()
    transform = transforms.Compose([
        transforms.Resize((224, 224)),
        transforms.ToTensor(),
        transforms.Normalize(
            mean=(0.485, 0.456, 0.406),
            std=(0.229, 0.224, 0.225),
        ),
    ])
    return torch, model, transform


def encode_image(torch, model, transform, image_path: Path):
    from PIL import Image

    tensor = transform(Image.open(image_path).convert("RGB")).unsqueeze(0)
    with torch.inference_mode():
        vector = model(tensor)
    vector = torch.nn.functional.normalize(vector, dim=1)[0].cpu().tolist()
    return [round(float(value), 8) for value in vector]


def index_references(_project_root: Path, manifest_path: Path, output_path: Path):
    torch, model, transform = load_model()
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    root = manifest_path.parent
    references = []
    for reference in manifest.get("references", []):
        image = root / reference["image"]
        if not image.exists():
            continue
        references.append({**reference, "embedding": encode_image(torch, model, transform, image)})
    output_path.parent.mkdir(parents=True, exist_ok=True)
    result = {
        "model": MODEL_NAME,
        "indexedAt": manifest.get("compiledAt"),
        "references": references,
    }
    output_path.write_text(json.dumps(result), encoding="utf-8")
    return {
        "engine": "dinov2-reference-matching",
        "model": MODEL_NAME,
        "references": len(references),
        "heroes": len({reference["heroId"] for reference in references}),
    }


def match_image(
    _project_root: Path,
    index_path: Path,
    image_path: Path,
    surface: str,
    hero_ids: set[int],
    minimum_confidence: float,
    minimum_margin: float,
):
    import torch

    _, model, transform = load_model()
    index = json.loads(index_path.read_text(encoding="utf-8"))
    query = torch.tensor(encode_image(torch, model, transform, image_path))
    references = [
        reference for reference in index.get("references", [])
        if reference.get("surface") == surface and (not hero_ids or int(reference.get("heroId", -1)) in hero_ids)
    ]
    ranked = []
    for reference in references:
        score = float(torch.dot(query, torch.tensor(reference["embedding"])).item())
        ranked.append({
            "heroId": reference["heroId"],
            "heroName": reference["heroName"],
            "variant": reference["variant"],
            "source": reference["source"],
            "confidence": round(score, 6),
        })
    ranked.sort(key=lambda entry: entry["confidence"], reverse=True)
    unique = []
    seen = set()
    for entry in ranked:
        if entry["heroId"] in seen:
            continue
        seen.add(entry["heroId"])
        unique.append(entry)
        if len(unique) >= 5:
            break
    best = unique[0] if unique else None
    second = unique[1] if len(unique) > 1 else None
    margin = round((best["confidence"] - second["confidence"]) if best and second else 0.0, 6)
    accepted = bool(best and best["confidence"] >= minimum_confidence and (not second or margin >= minimum_margin))
    return {
        "engine": "dinov2-reference-matching",
        "model": MODEL_NAME,
        "surface": surface,
        "rosterConstrained": bool(hero_ids),
        "accepted": accepted,
        "identity": best if accepted else None,
        "margin": margin,
        "ranking": unique,
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=["status", "index", "match"])
    parser.add_argument("--project-root", required=True)
    parser.add_argument("--manifest")
    parser.add_argument("--output")
    parser.add_argument("--index")
    parser.add_argument("--image")
    parser.add_argument("--surface", choices=["draft", "live_minimap"], default="draft")
    parser.add_argument("--hero-ids", default="")
    parser.add_argument("--minimum-confidence", type=float, default=0.72)
    parser.add_argument("--minimum-margin", type=float, default=0.03)
    args = parser.parse_args()
    root = Path(args.project_root).resolve()
    try:
        if args.command == "status":
            result = status(root)
        elif args.command == "index":
            result = index_references(root, Path(args.manifest), Path(args.output))
        else:
            hero_ids = {int(value) for value in args.hero_ids.split(",") if value.strip().isdigit()}
            result = match_image(
                root,
                Path(args.index),
                Path(args.image),
                args.surface,
                hero_ids,
                args.minimum_confidence,
                args.minimum_margin,
            )
        print(json.dumps({"ok": True, "data": result}))
    except Exception as error:
        print(json.dumps({"ok": False, "error": str(error)}))
        raise


if __name__ == "__main__":
    main()
