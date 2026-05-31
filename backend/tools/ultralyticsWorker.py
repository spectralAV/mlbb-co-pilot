import json
import os
import shutil
import sys
from pathlib import Path

import cv2
import numpy as np
import torch
from ultralytics import YOLO

INFERENCE_IMAGE_SIZE = 960
NMS_IOU_THRESHOLD = 0.7
DIRECTML_ALIASES = {"directml", "dml", "amd", "amd-gpu"}

CLASSES = [
    "minimap_panel",
    "draft_screen",
    "equipment_scoreboard",
    "attributes_scoreboard",
    "ally_pick_slot",
    "enemy_pick_slot",
    "ally_ban_slot",
    "enemy_ban_slot",
    "lane_marker",
    "battle_spell_marker",
    "ally_hero_marker",
    "enemy_hero_marker",
    "turtle",
    "lord",
    "ally_turret",
    "enemy_turret",
    "turtle_respawn_timer",
    "lord_respawn_timer",
    "enemy_respawn_timer",
    "ally_respawn_timer",
    "minimap_objective_timer",
    "score_counter",
    "match_timer",
    "ally_kill_counter",
    "enemy_kill_counter",
    "personal_kda",
    "personal_gold_counter",
    "live_hud_stats_region",
    "red_buff",
    "blue_buff",
    "jungle_creep",
    "little_wonder",
    "post_match_item_slot",
]


def resolve_torch_device(requested_device=None):
    requested = str(requested_device or os.environ.get("ULTRALYTICS_DEVICE") or "auto").strip()
    normalized = requested.lower()
    if normalized in ("", "auto"):
        if torch.cuda.is_available() and torch.cuda.device_count() > 0:
            return "0"
        if getattr(getattr(torch, "backends", None), "mps", None) and torch.backends.mps.is_available():
            return "mps"
        return "cpu"
    if normalized in ("cuda", "rocm", "hip"):
        return "0"
    return requested


def directml_available():
    try:
        import onnxruntime as ort
    except Exception:
        return False
    return "DmlExecutionProvider" in ort.get_available_providers()


def should_use_directml(requested_device=None):
    requested = str(requested_device or os.environ.get("ULTRALYTICS_DEVICE") or "auto").strip().lower()
    return requested in DIRECTML_ALIASES or (requested in ("", "auto") and directml_available())


def normalize_torch_detections(predictions):
    detections = []
    for prediction in predictions:
        names = prediction.names
        height, width = prediction.orig_shape
        for box in prediction.boxes:
            class_id = int(box.cls[0].item())
            score = float(box.conf[0].item())
            left, top, right, bottom = [float(value) for value in box.xyxy[0].tolist()]
            detections.append(normalized_detection(class_id, score, left, top, right, bottom, width, height))
    return detections


def normalized_detection(class_id, score, left, top, right, bottom, width, height):
    left = float(np.clip(left, 0, width))
    top = float(np.clip(top, 0, height))
    right = float(np.clip(right, 0, width))
    bottom = float(np.clip(bottom, 0, height))
    return {
        "classId": class_id,
        "className": CLASSES[class_id] if 0 <= class_id < len(CLASSES) else str(class_id),
        "confidence": round(float(score), 5),
        "bbox": [
            round(left / width, 6),
            round(top / height, 6),
            round((right - left) / width, 6),
            round((bottom - top) / height, 6),
        ],
        "center": [
            round((left + right) / 2 / width, 6),
            round((top + bottom) / 2 / height, 6),
        ],
        "source": "ultralytics-yolo",
    }


class TorchBackend:
    def __init__(self, weights, requested_device):
        self.device = resolve_torch_device(requested_device)
        self.model = YOLO(str(weights))

    def predict(self, frame, confidence):
        predictions = self.model.predict(
            source=frame,
            conf=confidence,
            imgsz=INFERENCE_IMAGE_SIZE,
            verbose=False,
            device=self.device,
        )
        return normalize_torch_detections(predictions)


class DirectMlBackend:
    def __init__(self, weights):
        import onnxruntime as ort

        if "DmlExecutionProvider" not in ort.get_available_providers():
            raise RuntimeError("onnxruntime-directml did not expose DmlExecutionProvider.")
        self.onnx_path = ensure_onnx_export(weights)
        options = ort.SessionOptions()
        options.enable_mem_pattern = False
        self.session = ort.InferenceSession(
            str(self.onnx_path),
            sess_options=options,
            providers=["DmlExecutionProvider", "CPUExecutionProvider"],
        )
        self.input_name = self.session.get_inputs()[0].name

    def predict(self, frame, confidence):
        blob, ratio, pad_x, pad_y = letterbox_blob(frame)
        outputs = self.session.run(None, {self.input_name: blob})
        predictions = yolo_output_to_rows(outputs[0])
        return decode_onnx_detections(predictions, frame.shape[1], frame.shape[0], ratio, pad_x, pad_y, confidence)


def ensure_onnx_export(weights):
    onnx_path = weights.with_suffix(".onnx")
    if onnx_path.exists() and onnx_path.stat().st_mtime >= weights.stat().st_mtime:
        return onnx_path
    model = YOLO(str(weights))
    exported = Path(model.export(
        format="onnx",
        imgsz=INFERENCE_IMAGE_SIZE,
        dynamic=False,
        simplify=False,
        opset=12,
        verbose=False,
    ))
    if exported.resolve() != onnx_path.resolve():
        onnx_path.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(exported, onnx_path)
    return onnx_path


def letterbox_blob(frame):
    height, width = frame.shape[:2]
    ratio = min(INFERENCE_IMAGE_SIZE / height, INFERENCE_IMAGE_SIZE / width)
    resized_width = int(round(width * ratio))
    resized_height = int(round(height * ratio))
    resized = cv2.resize(frame, (resized_width, resized_height), interpolation=cv2.INTER_LINEAR)
    pad_x = (INFERENCE_IMAGE_SIZE - resized_width) / 2
    pad_y = (INFERENCE_IMAGE_SIZE - resized_height) / 2
    left = int(round(pad_x - 0.1))
    right = int(round(pad_x + 0.1))
    top = int(round(pad_y - 0.1))
    bottom = int(round(pad_y + 0.1))
    padded = cv2.copyMakeBorder(resized, top, bottom, left, right, cv2.BORDER_CONSTANT, value=(114, 114, 114))
    rgb = cv2.cvtColor(padded, cv2.COLOR_BGR2RGB)
    blob = rgb.transpose(2, 0, 1)[None].astype(np.float32) / 255.0
    return np.ascontiguousarray(blob), ratio, left, top


def yolo_output_to_rows(output):
    prediction = np.asarray(output)
    if prediction.ndim == 3:
        prediction = prediction[0]
    if prediction.ndim != 2:
        raise RuntimeError(f"Unsupported ONNX output shape: {prediction.shape}")
    if prediction.shape[0] <= len(CLASSES) + 5 and prediction.shape[0] < prediction.shape[1]:
        prediction = prediction.T
    return prediction


def decode_onnx_detections(prediction, image_width, image_height, ratio, pad_x, pad_y, confidence):
    if prediction.shape[1] == 6:
        detections = []
        for row in prediction:
            score = float(row[4])
            if score < confidence:
                continue
            class_id = int(round(float(row[5])))
            if class_id < 0 or class_id >= len(CLASSES):
                continue
            left, top, right, bottom = [float(value) for value in row[:4]]
            left = (left - pad_x) / ratio
            top = (top - pad_y) / ratio
            right = (right - pad_x) / ratio
            bottom = (bottom - pad_y) / ratio
            if right <= left or bottom <= top:
                continue
            detections.append(normalized_detection(class_id, score, left, top, right, bottom, image_width, image_height))
        return sorted(detections, key=lambda detection: detection["confidence"], reverse=True)

    candidate_boxes_by_class = {class_id: [] for class_id in range(len(CLASSES))}
    candidate_scores_by_class = {class_id: [] for class_id in range(len(CLASSES))}
    candidate_raw_by_class = {class_id: [] for class_id in range(len(CLASSES))}

    for row in prediction:
        if row.shape[0] < 4 + len(CLASSES):
            continue
        if row.shape[0] >= 5 + len(CLASSES):
            objectness = float(row[4])
            class_scores = row[5:5 + len(CLASSES)]
            class_id = int(np.argmax(class_scores))
            score = objectness * float(class_scores[class_id])
        else:
            class_scores = row[4:4 + len(CLASSES)]
            class_id = int(np.argmax(class_scores))
            score = float(class_scores[class_id])
        if score < confidence:
            continue

        x_center, y_center, box_width, box_height = [float(value) for value in row[:4]]
        left = (x_center - box_width / 2 - pad_x) / ratio
        top = (y_center - box_height / 2 - pad_y) / ratio
        right = (x_center + box_width / 2 - pad_x) / ratio
        bottom = (y_center + box_height / 2 - pad_y) / ratio
        left = float(np.clip(left, 0, image_width))
        top = float(np.clip(top, 0, image_height))
        right = float(np.clip(right, 0, image_width))
        bottom = float(np.clip(bottom, 0, image_height))
        if right <= left or bottom <= top:
            continue

        candidate_boxes_by_class[class_id].append([left, top, right - left, bottom - top])
        candidate_scores_by_class[class_id].append(score)
        candidate_raw_by_class[class_id].append((class_id, score, left, top, right, bottom))

    detections = []
    for class_id in range(len(CLASSES)):
        boxes = candidate_boxes_by_class[class_id]
        scores = candidate_scores_by_class[class_id]
        if not boxes:
            continue
        indexes = cv2.dnn.NMSBoxes(boxes, scores, confidence, NMS_IOU_THRESHOLD)
        for index in np.array(indexes).reshape(-1):
            raw = candidate_raw_by_class[class_id][int(index)]
            detections.append(normalized_detection(*raw, image_width, image_height))
    return sorted(detections, key=lambda detection: detection["confidence"], reverse=True)


def build_backend(weights, requested_device):
    if should_use_directml(requested_device):
        return DirectMlBackend(weights)
    return TorchBackend(weights, requested_device)


def decode_raw_frame(frame_bytes, width, height, pixel_format):
    pixel_format = str(pixel_format or "").upper()
    channels = 4 if pixel_format in ("BGRA", "BGRX", "RGBA", "RGBX") else 3
    expected = int(width) * int(height) * channels
    if len(frame_bytes) != expected:
        raise RuntimeError(f"Raw {pixel_format} frame has {len(frame_bytes)} bytes, expected {expected}.")
    raw = np.frombuffer(frame_bytes, dtype=np.uint8).reshape((int(height), int(width), channels))
    if pixel_format in ("BGRA", "BGRX"):
        return cv2.cvtColor(raw, cv2.COLOR_BGRA2BGR)
    if pixel_format == "RGBA" or pixel_format == "RGBX":
        return cv2.cvtColor(raw, cv2.COLOR_RGBA2BGR)
    if pixel_format == "RGB":
        return cv2.cvtColor(raw, cv2.COLOR_RGB2BGR)
    if pixel_format == "BGR":
        return np.ascontiguousarray(raw)
    raise RuntimeError(f"Unsupported raw frame pixel format: {pixel_format}")


def decode_frame(frame_bytes, header):
    encoding = str(header.get("encoding") or "encoded").lower()
    if encoding == "raw":
        return decode_raw_frame(
            frame_bytes,
            int(header.get("width", 0)),
            int(header.get("height", 0)),
            header.get("pixelFormat") or header.get("pixel_format"),
        )
    frame = cv2.imdecode(np.frombuffer(frame_bytes, dtype=np.uint8), cv2.IMREAD_COLOR)
    if frame is None:
        raise RuntimeError("Could not decode the received image frame.")
    return frame


def main():
    if len(sys.argv) not in (2, 3):
        raise RuntimeError("Worker requires the trained model weights path and optional device.")
    weights = Path(sys.argv[1]).resolve()
    if not weights.exists():
        raise RuntimeError("No trained model weights found.")
    requested_device = sys.argv[2] if len(sys.argv) == 3 else None
    backend = build_backend(weights, requested_device)
    reader = sys.stdin.buffer
    writer = sys.stdout
    while True:
        header_line = reader.readline()
        if not header_line:
            return
        request_id = None
        try:
            header = json.loads(header_line.decode("utf-8"))
            request_id = header.get("id")
            size = int(header.get("size", 0))
            confidence = float(header.get("confidence", 0.55))
            frame_bytes = reader.read(size)
            if len(frame_bytes) != size:
                raise RuntimeError("Incomplete frame received.")
            frame = decode_frame(frame_bytes, header)
            payload = {"id": request_id, "ok": True, "detections": backend.predict(frame, confidence)}
        except Exception as error:
            payload = {"id": request_id, "ok": False, "error": str(error)}
        writer.write(json.dumps(payload) + "\n")
        writer.flush()


if __name__ == "__main__":
    main()
