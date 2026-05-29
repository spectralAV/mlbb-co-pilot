import argparse
import csv
import json
import re
import shutil
import sys
from datetime import datetime, timezone
from pathlib import Path


def require_cv2():
    try:
        import cv2
    except Exception as error:
        raise RuntimeError(
            "OpenCV is required to read video files. Install opencv-python-headless in the CV runtime."
        ) from error
    return cv2


def safe_name(value: str):
    cleaned = re.sub(r"[^A-Za-z0-9_.-]+", "-", value.strip())
    cleaned = cleaned.strip(".-")
    return cleaned or "video"


def project_paths(project_root: Path):
    cv_root = project_root / "data" / "cv"
    return {
        "cv_root": cv_root,
        "footage": cv_root / "footage",
        "images": cv_root / "images",
        "labels": cv_root / "labels",
    }


def write_manifest(path: Path, manifest: dict):
    path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")


def prepare_output_dir(output_dir: Path, overwrite: bool):
    if output_dir.exists():
        if not overwrite:
            existing = list(output_dir.iterdir())
            if existing:
                raise RuntimeError(f"Output directory already exists and is not empty: {output_dir}")
        else:
            shutil.rmtree(output_dir)
    (output_dir / "frames").mkdir(parents=True, exist_ok=True)


def image_write_params(cv2, image_format: str, jpeg_quality: int):
    if image_format == "jpg":
        return [int(cv2.IMWRITE_JPEG_QUALITY), int(jpeg_quality)]
    if image_format == "png":
        return [int(cv2.IMWRITE_PNG_COMPRESSION), 3]
    raise ValueError(f"Unsupported image format: {image_format}")


def copy_to_dataset(frame_path: Path, dataset_image: Path, dataset_label: Path):
    dataset_image.parent.mkdir(parents=True, exist_ok=True)
    dataset_label.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(frame_path, dataset_image)
    # Empty YOLO labels mark extracted footage frames as background negatives.
    dataset_label.write_text("", encoding="ascii")


def extract_frames(args):
    cv2 = require_cv2()
    project_root = Path(args.project_root).resolve()
    paths = project_paths(project_root)
    video = Path(args.video).expanduser().resolve()
    if not video.exists():
        raise RuntimeError(f"Video file does not exist: {video}")
    if args.stride < 1:
        raise RuntimeError("--stride must be 1 or higher.")
    if args.jpeg_quality < 1 or args.jpeg_quality > 100:
        raise RuntimeError("--jpeg-quality must be between 1 and 100.")

    name = safe_name(args.name or video.stem)
    output_dir = Path(args.output).resolve() if args.output else paths["footage"] / name
    prepare_output_dir(output_dir, args.overwrite)

    capture = cv2.VideoCapture(str(video))
    if not capture.isOpened():
        raise RuntimeError(f"Could not open video file: {video}")

    fps = float(capture.get(cv2.CAP_PROP_FPS) or 0.0)
    total_frames = int(capture.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    width = int(capture.get(cv2.CAP_PROP_FRAME_WIDTH) or 0)
    height = int(capture.get(cv2.CAP_PROP_FRAME_HEIGHT) or 0)
    start_frame = int(args.start_seconds * fps) if fps > 0 and args.start_seconds > 0 else 0
    end_frame = int(args.end_seconds * fps) if fps > 0 and args.end_seconds is not None else None
    if end_frame is not None and end_frame < start_frame:
        raise RuntimeError("--end-seconds must be greater than --start-seconds.")
    if start_frame > 0:
        capture.set(cv2.CAP_PROP_POS_FRAMES, start_frame)

    frames_dir = output_dir / "frames"
    csv_path = output_dir / "frames.csv"
    manifest_path = output_dir / "manifest.json"
    dataset_split = None if args.dataset_split == "none" else args.dataset_split
    dataset_rows = []
    extracted = 0
    read_frames = 0
    first_frame = None
    last_frame = None
    start_time = datetime.now(timezone.utc)
    params = image_write_params(cv2, args.format, args.jpeg_quality)

    with csv_path.open("w", newline="", encoding="utf-8") as csv_file:
        writer = csv.DictWriter(csv_file, fieldnames=[
            "sourceFrame",
            "outputFrame",
            "timestampSeconds",
            "datasetImage",
            "datasetLabel",
        ])
        writer.writeheader()

        while True:
            ok, frame = capture.read()
            if not ok:
                break
            source_frame = int(capture.get(cv2.CAP_PROP_POS_FRAMES)) - 1
            if source_frame < 0:
                source_frame = start_frame + read_frames
            if end_frame is not None and source_frame > end_frame:
                break
            read_frames += 1
            if (source_frame - start_frame) % args.stride != 0:
                continue
            if args.max_frames is not None and extracted >= args.max_frames:
                break

            frame_name = f"{name}-frame-{source_frame:06d}.{args.format}"
            frame_path = frames_dir / frame_name
            if not cv2.imwrite(str(frame_path), frame, params):
                raise RuntimeError(f"Could not write frame: {frame_path}")

            timestamp = source_frame / fps if fps > 0 else None
            row = {
                "sourceFrame": source_frame,
                "outputFrame": frame_path.relative_to(project_root).as_posix()
                if frame_path.is_relative_to(project_root)
                else str(frame_path),
                "timestampSeconds": f"{timestamp:.6f}" if timestamp is not None else "",
                "datasetImage": "",
                "datasetLabel": "",
            }

            if dataset_split:
                dataset_name = f"{name}-video-frame-{source_frame:06d}.{args.format}"
                dataset_image = paths["images"] / dataset_split / dataset_name
                dataset_label = paths["labels"] / dataset_split / f"{Path(dataset_name).stem}.txt"
                copy_to_dataset(frame_path, dataset_image, dataset_label)
                row["datasetImage"] = dataset_image.relative_to(project_root).as_posix()
                row["datasetLabel"] = dataset_label.relative_to(project_root).as_posix()
                dataset_rows.append({
                    "image": row["datasetImage"],
                    "label": row["datasetLabel"],
                    "mode": "background-negative",
                })

            writer.writerow(row)
            first_frame = source_frame if first_frame is None else first_frame
            last_frame = source_frame
            extracted += 1
            if args.progress_every and extracted % args.progress_every == 0:
                print(f"extracted {extracted} frames through source frame {source_frame}", file=sys.stderr)

    capture.release()

    manifest = {
        "ok": True,
        "createdAt": start_time.isoformat(),
        "video": str(video),
        "output": str(output_dir),
        "framesCsv": str(csv_path),
        "name": name,
        "fps": fps,
        "width": width,
        "height": height,
        "reportedFrameCount": total_frames,
        "startFrame": start_frame,
        "endFrame": end_frame,
        "stride": args.stride,
        "format": args.format,
        "extractedFrames": extracted,
        "firstExtractedSourceFrame": first_frame,
        "lastExtractedSourceFrame": last_frame,
        "datasetSplit": args.dataset_split,
        "datasetMode": "background-negative" if dataset_split else "none",
        "datasetFrames": dataset_rows,
    }
    write_manifest(manifest_path, manifest)
    return manifest


def main():
    parser = argparse.ArgumentParser(description="Extract every frame from video footage for CV training review.")
    parser.add_argument("--project-root", default=".")
    parser.add_argument("--video", required=True)
    parser.add_argument("--output", default=None)
    parser.add_argument("--name", default=None)
    parser.add_argument("--stride", type=int, default=1, help="Read every Nth frame. Default 1 reads every frame.")
    parser.add_argument("--max-frames", type=int, default=None)
    parser.add_argument("--start-seconds", type=float, default=0.0)
    parser.add_argument("--end-seconds", type=float, default=None)
    parser.add_argument("--format", choices=["jpg", "png"], default="jpg")
    parser.add_argument("--jpeg-quality", type=int, default=94)
    parser.add_argument("--dataset-split", choices=["none", "train", "val"], default="none")
    parser.add_argument("--progress-every", type=int, default=500)
    parser.add_argument("--overwrite", action="store_true")
    args = parser.parse_args()

    try:
        manifest = extract_frames(args)
        print(json.dumps({
            "ok": True,
            "video": manifest["video"],
            "output": manifest["output"],
            "framesCsv": manifest["framesCsv"],
            "extractedFrames": manifest["extractedFrames"],
            "datasetSplit": manifest["datasetSplit"],
            "datasetMode": manifest["datasetMode"],
        }))
    except Exception as error:
        print(json.dumps({"ok": False, "error": str(error)}))
        sys.exit(1)


if __name__ == "__main__":
    main()
