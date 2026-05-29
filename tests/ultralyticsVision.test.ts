import assert from "node:assert/strict";
import { test } from "node:test";
import {
  mapUltralyticsMinimapMarkers,
  mapUltralyticsMinimapObjects,
  publishNativeObsDetections,
  resetUltralyticsTracking,
  stabilizeUltralyticsDetections,
} from "../backend/src/vision/ultralyticsVision.ts";
import { getMatchState, resetMatchState } from "../backend/src/state/matchState.ts";

test("ultralytics hero marker detections project into normalized minimap coordinates", () => {
  const markers = mapUltralyticsMinimapMarkers([
    {
      classId: 11,
      className: "enemy_hero_marker",
      confidence: 0.91,
      bbox: [0.09, 0.06, 0.01, 0.01],
      center: [0.02521 + 0.146359 * 0.5, 0.326563 * 0.25],
      source: "ultralytics-yolo",
    },
  ]);

  assert.equal(markers.length, 1);
  assert.equal(markers[0].side, "enemy");
  assert.equal(markers[0].markerClass, "ultralytics-yolo");
  assert.deepEqual(markers[0].minimap.map((value) => Number(value.toFixed(4))), [0.5, 0.25]);
});

test("ultralytics ignores hero marker boxes outside the calibrated minimap", () => {
  const markers = mapUltralyticsMinimapMarkers([
    {
      classId: 10,
      className: "ally_hero_marker",
      confidence: 0.98,
      bbox: [0.5, 0.5, 0.02, 0.02],
      center: [0.51, 0.51],
      source: "ultralytics-yolo",
    },
  ]);

  assert.deepEqual(markers, []);
});

test("ultralytics maps markers through a selected calibration minimap region", () => {
  const markers = mapUltralyticsMinimapMarkers([{
    classId: 11,
    className: "enemy_hero_marker",
    confidence: 0.92,
    bbox: [0.3, 0.2, 0.01, 0.01],
    center: [0.3, 0.25],
    source: "ultralytics-yolo",
  }], [0.2, 0.1, 0.4, 0.3]);
  assert.deepEqual(markers[0].minimap.map((value) => Number(value.toFixed(4))), [0.25, 0.5]);
});

test("ultralytics maps objective and turret objects only inside calibrated minimap", () => {
  const objects = mapUltralyticsMinimapObjects([
    {
      classId: 13,
      className: "lord",
      confidence: 0.93,
      bbox: [0.28, 0.2, 0.02, 0.02],
      center: [0.3, 0.25],
      source: "ultralytics-yolo",
    },
    {
      classId: 15,
      className: "enemy_turret",
      confidence: 0.89,
      bbox: [0.9, 0.9, 0.02, 0.02],
      center: [0.91, 0.91],
      source: "ultralytics-yolo",
    },
  ], [0.2, 0.1, 0.4, 0.3]);
  assert.equal(objects.length, 1);
  assert.equal(objects[0].objectType, "lord");
  assert.deepEqual(objects[0].minimap.map((value) => Number(value.toFixed(4))), [0.25, 0.5]);
});

test("ultralytics tracker keeps stable ids for matching detections", () => {
  resetUltralyticsTracking("tracker-test");
  const first = stabilizeUltralyticsDetections([{
    classId: 11,
    className: "enemy_hero_marker",
    confidence: 0.91,
    bbox: [0.08, 0.08, 0.02, 0.02],
    center: [0.09, 0.09],
    source: "ultralytics-yolo",
  }], { streamId: "tracker-test", now: 1000 });
  const second = stabilizeUltralyticsDetections([{
    classId: 11,
    className: "enemy_hero_marker",
    confidence: 0.93,
    bbox: [0.085, 0.08, 0.02, 0.02],
    center: [0.095, 0.09],
    source: "ultralytics-yolo",
  }], { streamId: "tracker-test", now: 1800, smoothing: 0.5 });

  assert.equal(second[0].trackId, first[0].trackId);
  assert.equal(second[0].trackAge, 2);
  assert.equal(second[0].trackMissingFrames, 0);
  assert.ok(second[0].center[0] > first[0].center[0]);
  assert.ok(second[0].center[0] < 0.095);
});

test("ultralytics minimap ids prefer stable track ids", () => {
  resetUltralyticsTracking("marker-id-test");
  const tracked = stabilizeUltralyticsDetections([{
    classId: 10,
    className: "ally_hero_marker",
    confidence: 0.97,
    bbox: [0.08, 0.08, 0.01, 0.01],
    center: [0.02521 + 0.146359 * 0.5, 0.326563 * 0.25],
    source: "ultralytics-yolo",
  }], { streamId: "marker-id-test", now: 1000 });
  const markers = mapUltralyticsMinimapMarkers(tracked);

  assert.equal(markers.length, 1);
  assert.equal(markers[0].id, tracked[0].trackId);
});

test("ultralytics tracker expires stale tracks instead of reviving old ids", () => {
  resetUltralyticsTracking("expiry-test");
  const first = stabilizeUltralyticsDetections([{
    classId: 13,
    className: "lord",
    confidence: 0.91,
    bbox: [0.3, 0.2, 0.02, 0.02],
    center: [0.31, 0.21],
    source: "ultralytics-yolo",
  }], { streamId: "expiry-test", now: 1000, maxAgeMs: 100 });
  const second = stabilizeUltralyticsDetections([{
    classId: 13,
    className: "lord",
    confidence: 0.92,
    bbox: [0.3, 0.2, 0.02, 0.02],
    center: [0.31, 0.21],
    source: "ultralytics-yolo",
  }], { streamId: "expiry-test", now: 1200, maxAgeMs: 100 });

  assert.notEqual(second[0].trackId, first[0].trackId);
});

test("native OBS Ultralytics facts reach MatchState without a browser capture runtime", () => {
  resetMatchState();
  publishNativeObsDetections([
    {
      classId: 11,
      className: "enemy_hero_marker",
      confidence: 0.91,
      bbox: [0.08, 0.08, 0.02, 0.02],
      center: [0.02521 + 0.146359 * 0.5, 0.326563 * 0.25],
      source: "ultralytics-yolo",
    },
    {
      classId: 13,
      className: "lord",
      confidence: 0.88,
      bbox: [0.45, 0.45, 0.08, 0.08],
      center: [0.49, 0.49],
      source: "ultralytics-yolo",
    },
  ], "obs-test");
  const state = getMatchState();
  assert.equal(state.lifecycle?.source, "obs-test:ultralytics");
  assert.equal(state.lifecycle?.screen, "live_hud");
  assert.equal(state.vision?.minimapMarkers?.[0]?.side, "enemy");
  assert.deepEqual(state.vision?.signals?.yoloDetections.map((fact: any) => fact.className), ["enemy_hero_marker", "lord"]);
});

test("native OBS Ultralytics draft surfaces choose draft lifecycle directly", () => {
  resetMatchState();
  publishNativeObsDetections([
    {
      classId: 1,
      className: "draft_screen",
      confidence: 0.94,
      bbox: [0, 0, 1, 1],
      center: [0.5, 0.5],
      source: "ultralytics-yolo",
    },
  ], "obs-test");
  assert.equal(getMatchState().lifecycle?.screen, "draft");
  assert.equal(getMatchState().confidence.visionTrusted, true);
});

test("native OBS Ultralytics minimap surface leaves draft for live HUD", () => {
  resetMatchState();
  publishNativeObsDetections([
    {
      classId: 1,
      className: "draft_screen",
      confidence: 0.94,
      bbox: [0, 0, 1, 1],
      center: [0.5, 0.5],
      source: "ultralytics-yolo",
    },
  ], "obs-test");
  publishNativeObsDetections([
    {
      classId: 0,
      className: "minimap_panel",
      confidence: 0.95,
      bbox: [0.025, 0, 0.146, 0.327],
      center: [0.098, 0.164],
      source: "ultralytics-yolo",
    },
  ], "obs-test");
  assert.equal(getMatchState().lifecycle?.screen, "live_hud");
  assert.equal(getMatchState().confidence.visionTrusted, true);
});
