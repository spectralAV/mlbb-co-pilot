import assert from "node:assert/strict";
import { test } from "node:test";
import {
  filterYoloDetectionsForScreen,
  minimapPanelRectFromYolo,
  shouldQueueUltralyticsInference,
} from "../frontend/src/vision/yoloScreenGate.ts";
import { mapYoloMinimapMarkers, mergeMinimapMarkers } from "../frontend/src/vision/minimapYolo.ts";

test("shouldQueueUltralyticsInference skips loading and lobby", () => {
  assert.equal(shouldQueueUltralyticsInference("loading"), false);
  assert.equal(shouldQueueUltralyticsInference("lobby"), false);
  assert.equal(shouldQueueUltralyticsInference("live_hud"), true);
  assert.equal(shouldQueueUltralyticsInference("draft"), true);
});

test("filterYoloDetectionsForScreen keeps draft slots on draft only", () => {
  const detections = [
    { className: "ally_pick_slot", confidence: 0.9, bbox: [0, 0, 0.1, 0.1] as [number, number, number, number], center: [0.05, 0.05] as [number, number] },
    { className: "red_buff", confidence: 0.9, bbox: [0, 0, 0.1, 0.1] as [number, number, number, number], center: [0.05, 0.05] as [number, number] },
  ];
  const draft = filterYoloDetectionsForScreen(detections, "draft");
  assert.equal(draft.length, 1);
  assert.equal(draft[0]?.className, "ally_pick_slot");
  const live = filterYoloDetectionsForScreen(detections, "live_hud");
  assert.equal(live.length, 1);
  assert.equal(live[0]?.className, "red_buff");
});

test("minimapPanelRectFromYolo uses highest-confidence panel", () => {
  const fallback: [number, number, number, number] = [0.02, 0, 0.14, 0.32];
  const rect = minimapPanelRectFromYolo([
    { className: "minimap_panel", confidence: 0.6, bbox: [0.03, 0, 0.15, 0.33], center: [0.1, 0.15] },
    { className: "minimap_panel", confidence: 0.9, bbox: [0.04, 0.01, 0.16, 0.34], center: [0.12, 0.16] },
  ], fallback);
  assert.deepEqual(rect, [0.04, 0.01, 0.16, 0.34]);
});

test("mergeMinimapMarkers prefers YOLO near color blobs", () => {
  const yolo = mapYoloMinimapMarkers([
    { className: "enemy_hero_marker", confidence: 0.88, bbox: [0.05, 0.05, 0.02, 0.02], center: [0.11, 0.2] },
  ], [0.02, 0, 0.14, 0.32], 1000);
  const color = [{
    id: "enemy-0",
    side: "enemy" as const,
    markerClass: "team-color-candidate" as const,
    minimap: [0.68, 0.55] as [number, number],
    confidence: 0.7,
    sampledAt: 1000,
  }];
  const merged = mergeMinimapMarkers(color, yolo);
  assert.equal(merged.length, 2);
});
