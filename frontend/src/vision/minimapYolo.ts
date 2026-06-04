import type { MinimapMarkerDetection } from "../runtime/captureRuntime";
import type { YoloDetectionLike } from "./yoloScreenGate";

export type NormalizedRect = [number, number, number, number];

export type MinimapObjectDetection = {
  id: string;
  objectType: "turtle" | "lord" | "ally_turret" | "enemy_turret";
  minimap: [number, number];
  confidence: number;
  source: "ultralytics-yolo";
};

function clamp01(value: number) {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

function inMinimap(center: [number, number], minimap: NormalizedRect) {
  return center[0] >= minimap[0]
    && center[0] <= minimap[0] + minimap[2]
    && center[1] >= minimap[1]
    && center[1] <= minimap[1] + minimap[3];
}

function toMinimapPoint(center: [number, number], minimap: NormalizedRect): [number, number] {
  return [
    clamp01((center[0] - minimap[0]) / minimap[2]),
    clamp01((center[1] - minimap[1]) / minimap[3]),
  ];
}

export function mapYoloMinimapMarkers(
  detections: YoloDetectionLike[],
  minimap: NormalizedRect,
  sampledAt: number,
): MinimapMarkerDetection[] {
  return detections
    .filter((detection) =>
      (detection.className === "ally_hero_marker" || detection.className === "enemy_hero_marker")
      && detection.confidence >= 0.45
      && inMinimap(detection.center, minimap))
    .map((detection, index) => ({
      id: `yolo-${detection.className}-${index}`,
      side: detection.className === "enemy_hero_marker" ? "enemy" as const : "ally" as const,
      markerClass: "team-color-candidate" as const,
      minimap: toMinimapPoint(detection.center, minimap),
      confidence: clamp01(detection.confidence),
      sampledAt,
    }));
}

export function mapYoloMinimapObjects(detections: YoloDetectionLike[], minimap: NormalizedRect): MinimapObjectDetection[] {
  const objectClasses = new Set(["turtle", "lord", "ally_turret", "enemy_turret"]);
  return detections
    .filter((detection) =>
      objectClasses.has(detection.className)
      && detection.confidence >= 0.45
      && inMinimap(detection.center, minimap))
    .map((detection, index) => ({
      id: `yolo-map-${detection.className}-${index}`,
      objectType: detection.className as MinimapObjectDetection["objectType"],
      minimap: toMinimapPoint(detection.center, minimap),
      confidence: clamp01(detection.confidence),
      source: "ultralytics-yolo" as const,
    }));
}

function markerDistance(left: MinimapMarkerDetection, right: MinimapMarkerDetection) {
  const dx = left.minimap[0] - right.minimap[0];
  const dy = left.minimap[1] - right.minimap[1];
  return Math.hypot(dx, dy);
}

/** Prefer higher-confidence markers; drop color blobs within ~8% minimap space of a YOLO hit. */
export function mergeMinimapMarkers(
  colorMarkers: MinimapMarkerDetection[],
  yoloMarkers: MinimapMarkerDetection[],
): MinimapMarkerDetection[] {
  if (!yoloMarkers.length) return colorMarkers;
  const merged = [...yoloMarkers];
  for (const color of colorMarkers) {
    const duplicate = yoloMarkers.some((yolo) =>
      yolo.side === color.side && markerDistance(color, yolo) < 0.08,
    );
    if (!duplicate) merged.push(color);
  }
  return merged
    .sort((left, right) => right.confidence - left.confidence)
    .slice(0, 12);
}
