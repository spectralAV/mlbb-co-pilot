import argparse
import importlib.util
import json
import tempfile
from pathlib import Path


DEFAULT_REGIONS = [
    {"key": "top_hud", "rect": [0.32, 0.0, 0.36, 0.08]},
    {"key": "kill_feed", "rect": [0.3, 0.08, 0.4, 0.18]},
    {"key": "scoreboard_modal", "rect": [0.1, 0.13, 0.8, 0.78]},
    {"key": "draft_header", "rect": [0.25, 0.0, 0.5, 0.12]},
    {"key": "result_banner", "rect": [0.24, 0.14, 0.52, 0.2]},
]


def status(_project_root: Path):
    return {
        "engine": "paddleocr-screen",
        "packageAvailable": importlib.util.find_spec("paddleocr") is not None,
        "paddleAvailable": importlib.util.find_spec("paddle") is not None,
        "defaultRegions": DEFAULT_REGIONS,
    }


def is_rect(value):
    return (
        isinstance(value, list)
        and len(value) == 4
        and all(isinstance(item, (int, float)) and 0 <= item <= 1 for item in value)
    )


def normalize_regions(raw):
    if not raw:
        return DEFAULT_REGIONS
    parsed = json.loads(raw)
    candidates = parsed if isinstance(parsed, list) else []
    regions = []
    for index, item in enumerate(candidates):
        if not isinstance(item, dict):
            continue
        key = str(item.get("key") or f"region_{index}").strip()[:48]
        rect = item.get("rect")
        if key and is_rect(rect):
            regions.append({"key": key, "rect": [float(value) for value in rect]})
    return regions[:8] or DEFAULT_REGIONS


def create_reader():
    if importlib.util.find_spec("paddleocr") is None or importlib.util.find_spec("paddle") is None:
        raise RuntimeError("PaddleOCR runtime is not installed.")
    from paddleocr import PaddleOCR

    try:
        return PaddleOCR(
            lang="en",
            ocr_version="PP-OCRv5",
            text_detection_model_name="PP-OCRv5_mobile_det",
            text_recognition_model_name="en_PP-OCRv5_mobile_rec",
            use_doc_orientation_classify=False,
            use_doc_unwarping=False,
            use_textline_orientation=False,
            device="cpu",
            engine="paddle_static",
            enable_hpi=False,
            enable_mkldnn=False,
            cpu_threads=2,
        )
    except TypeError:
        return PaddleOCR(lang="en", use_angle_cls=False)


def predict(reader, image: Path):
    if hasattr(reader, "predict"):
        return reader.predict(str(image))
    return reader.ocr(str(image), cls=False)


def append_candidate(candidates, text, score=0.0, bbox=None):
    text = str(text or "").strip()
    if not text:
        return
    try:
        confidence = float(score or 0.0)
    except (TypeError, ValueError):
        confidence = 0.0
    item = {"text": text, "confidence": max(0.0, min(1.0, confidence))}
    if bbox is not None:
        item["bbox"] = bbox
    candidates.append(item)


def read_results(value, candidates):
    if hasattr(value, "json"):
        read_results(value.json, candidates)
        return
    if isinstance(value, dict):
        rec_texts = value.get("rec_texts")
        if isinstance(rec_texts, list):
            scores = value.get("rec_scores") if isinstance(value.get("rec_scores"), list) else []
            boxes = value.get("rec_boxes") if isinstance(value.get("rec_boxes"), list) else []
            polys = value.get("rec_polys") if isinstance(value.get("rec_polys"), list) else []
            for index, text in enumerate(rec_texts):
                bbox = boxes[index] if index < len(boxes) else polys[index] if index < len(polys) else None
                append_candidate(candidates, text, scores[index] if index < len(scores) else 0.0, bbox)
        text = next((value.get(key) for key in ("rec_text", "text", "label") if isinstance(value.get(key), str)), None)
        score = next((value.get(key) for key in ("rec_score", "score", "confidence") if isinstance(value.get(key), (int, float))), 0.0)
        if text:
            append_candidate(candidates, text, score)
        coordinate_keys = {
            "rec_boxes",
            "rec_polys",
            "dt_boxes",
            "dt_polys",
            "input_img",
            "page_index",
            "model_settings",
            "rec_scores",
            "rec_texts",
        }
        for key, item in value.items():
            if key in coordinate_keys:
                continue
            read_results(item, candidates)
    elif isinstance(value, (list, tuple)):
        if value and all(isinstance(item, (int, float)) for item in value):
            return
        if len(value) >= 2 and isinstance(value[-1], (list, tuple)) and len(value[-1]) >= 2:
            append_candidate(candidates, value[-1][0], value[-1][1])
        for item in value:
            read_results(item, candidates)


def dedupe(candidates):
    seen = set()
    unique = []
    for item in candidates:
        key = (item["text"], round(item["confidence"], 4))
        if key in seen:
            continue
        seen.add(key)
        unique.append(item)
    return unique


def reading_order(item):
    bbox = item.get("bbox")
    if isinstance(bbox, list) and len(bbox) >= 4 and all(isinstance(value, (int, float)) for value in bbox[:4]):
        return (int(float(bbox[1]) / 24), float(bbox[0]))
    return (999, 0)


def crop_rect(image, rect):
    width, height = image.size
    left = max(0, min(width - 1, int(rect[0] * width)))
    top = max(0, min(height - 1, int(rect[1] * height)))
    right = max(left + 1, min(width, int((rect[0] + rect[2]) * width)))
    bottom = max(top + 1, min(height, int((rect[1] + rect[3]) * height)))
    return image.crop((left, top, right, bottom))


def infer(_project_root: Path, image: Path, regions_json: str):
    from PIL import Image

    regions = normalize_regions(regions_json)
    reader = create_reader()
    output = []
    with tempfile.TemporaryDirectory(prefix="mlbb-screen-ocr-") as temp_dir:
        temp = Path(temp_dir)
        with Image.open(image) as source:
            source = source.convert("RGB")
            for region in regions:
                crop = crop_rect(source, region["rect"])
                crop_file = temp / f"{region['key']}.png"
                crop.save(crop_file)
                candidates = []
                read_results(predict(reader, crop_file), candidates)
                candidates = dedupe(candidates)
                accepted = [item for item in candidates if item["text"]]
                ordered = sorted(accepted, key=reading_order)
                ranked = sorted(accepted, key=lambda item: item["confidence"], reverse=True)
                text = " ".join(item["text"] for item in ordered[:8]).strip()
                confidence = sum(item["confidence"] for item in ranked[:8]) / min(len(ranked), 8) if ranked else 0.0
                output.append({
                    "key": region["key"],
                    "rect": region["rect"],
                    "text": text,
                    "confidence": round(confidence, 6),
                    "candidates": ordered[:12],
                })
    return {
        "engine": "paddleocr-screen",
        "regions": output,
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=["status", "infer"])
    parser.add_argument("--project-root", required=True)
    parser.add_argument("--image")
    parser.add_argument("--regions-json", default="")
    args = parser.parse_args()
    root = Path(args.project_root).resolve()
    try:
        result = status(root) if args.command == "status" else infer(root, Path(args.image), args.regions_json)
        print(json.dumps({"ok": True, "data": result}))
    except Exception as error:
        print(json.dumps({"ok": False, "error": str(error)}))


if __name__ == "__main__":
    main()
