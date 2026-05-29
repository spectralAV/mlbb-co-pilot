import argparse
import importlib.util
import json
from pathlib import Path


def status(_project_root: Path):
    return {
        "engine": "paddleocr-timer",
        "packageAvailable": importlib.util.find_spec("paddleocr") is not None,
        "paddleAvailable": importlib.util.find_spec("paddle") is not None,
        "targets": [
            "turtle_respawn_timer",
            "lord_respawn_timer",
            "enemy_respawn_timer",
            "ally_respawn_timer",
            "minimap_objective_timer",
            "score_counter",
        ],
    }


def read_results(value, candidates):
    if isinstance(value, dict):
        text_keys = ("rec_text", "text", "label")
        score_keys = ("rec_score", "score", "confidence")
        text = next((value.get(key) for key in text_keys if isinstance(value.get(key), str)), None)
        score = next((value.get(key) for key in score_keys if isinstance(value.get(key), (int, float))), None)
        if text:
            candidates.append((text, float(score or 0)))
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
            text, score = value[-1][0], value[-1][1]
            if isinstance(text, str) and isinstance(score, (int, float)):
                candidates.append((text, float(score)))
        for item in value:
            read_results(item, candidates)
    elif hasattr(value, "json"):
        read_results(value.json, candidates)


def infer(_project_root: Path, image: Path, timer_type: str):
    if importlib.util.find_spec("paddleocr") is None or importlib.util.find_spec("paddle") is None:
        raise RuntimeError("PaddleOCR runtime is not installed.")
    from paddleocr import PaddleOCR

    try:
        reader = PaddleOCR(
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
        output = reader.predict(str(image))
    except TypeError:
        reader = PaddleOCR(lang="en", use_angle_cls=False)
        output = reader.ocr(str(image), cls=False)
    candidates = []
    read_results(output, candidates)
    candidates.sort(key=lambda entry: entry[1], reverse=True)
    text, confidence = candidates[0] if candidates else ("", 0.0)
    return {
        "engine": "paddleocr-timer",
        "timerType": timer_type,
        "text": text,
        "confidence": round(confidence, 6),
        "candidates": [{"text": item[0], "confidence": round(item[1], 6)} for item in candidates[:5]],
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=["status", "infer"])
    parser.add_argument("--project-root", required=True)
    parser.add_argument("--image")
    parser.add_argument("--timer-type", default="enemy_respawn_timer")
    args = parser.parse_args()
    root = Path(args.project_root).resolve()
    try:
        result = status(root) if args.command == "status" else infer(root, Path(args.image), args.timer_type)
        print(json.dumps({"ok": True, "data": result}))
    except Exception as error:
        print(json.dumps({"ok": False, "error": str(error)}))


if __name__ == "__main__":
    main()
