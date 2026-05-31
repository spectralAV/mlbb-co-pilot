import assert from "node:assert/strict";
import { test } from "node:test";
import { getLatestLiveVisionObservation, ingestLiveVisionFrame, parseLiveVisionFrameInput } from "../backend/src/vision/liveVisionState.ts";

test("live vision frame parser sanitizes known CV facts without rejecting optional misses", () => {
  const input = parseLiveVisionFrameInput({
    frameId: "frame-1",
    source: "capture",
    timestamp: "1234",
    screen: "live_hud",
    confidence: "0.86",
    evidence: ["minimap", 2, null],
    layoutProfile: { id: "phone_20_9", label: "20:9 phone", aspectRatio: 2.222, sourceWidth: 2400, sourceHeight: 1080, confidence: 0.98 },
    anchors: [
      { key: "minimap", label: "Minimap", rect: [0.02, 0, 0.14, 0.31], confidence: 0.9, active: true },
      { key: "bad", label: "Broken", rect: [2, 0, 1, 1], confidence: 0.9, active: true },
    ],
    regions: {
      minimap: { mean: "22", contrast: 41, changed: 9, active: true },
      broken: "ignored",
    },
    minimapMarkers: [
      { id: "enemy-1", side: "enemy", markerClass: "ultralytics-yolo", minimap: [0.75, 0.3], confidence: 0.91 },
      { id: "bad-marker", side: "enemy", minimap: ["bad"], confidence: 0.9 },
    ],
    signals: {
      enemyItems: ["Dominance Ice"],
      yoloDetections: [
        { classId: 12, className: "enemy_hero_marker", confidence: 0.82, bbox: [0.1, 0.1, 0.05, 0.05], center: [0.12, 0.12], source: "ultralytics-yolo" },
        { classId: 12, className: "bad", confidence: 0.9, bbox: [0.1], center: [0.12, 0.12], source: "ultralytics-yolo" },
      ],
      timerFacts: [
        { timerType: "turtle_respawn_timer", text: "0:28", seconds: 28, confidence: 0.88, source: "timer-ocr", confirmedAt: 1234 },
        { timerType: "unknown_timer", text: "0:28", seconds: 28, confidence: 0.88, source: "timer-ocr", confirmedAt: 1234 },
      ],
    },
  });

  assert.equal(input.screen, "live_hud");
  assert.equal(input.timestamp, 1234);
  assert.equal(input.confidence, 0.86);
  assert.equal(input.layoutProfile?.id, "phone_20_9");
  assert.equal(input.anchors?.length, 1);
  assert.equal(input.regions?.minimap?.active, true);
  assert.equal(input.regions?.broken, undefined);
  assert.equal(input.minimapMarkers?.length, 1);
  assert.equal(input.signals?.yoloDetections?.length, 1);
  assert.equal(input.signals?.timerFacts?.length, 1);
});

test("live vision parser falls back to safe screen state and ingestion remains tolerant", () => {
  const input = parseLiveVisionFrameInput({
    screen: "not-a-screen",
    confidence: "not-a-number",
    minimapMarkers: [
      { id: "ally-1", side: "ally", minimap: [0.2, 0.8], confidence: 0.75 },
    ],
  });
  const snapshot = ingestLiveVisionFrame(input);

  assert.equal(input.screen, "unknown");
  assert.equal(input.confidence, undefined);
  assert.equal(snapshot.screen, "unknown");
  assert.equal(snapshot.confidence, 0);
  assert.equal(snapshot.minimapMarkers.length, 1);
});

test("live vision parser rejects non-object frame bodies at the route boundary", () => {
  assert.throws(() => parseLiveVisionFrameInput(null), /must be a JSON object/i);
  assert.throws(() => parseLiveVisionFrameInput("frame"), /must be a JSON object/i);
});

test("live vision observation summary exposes stale, minimap, and timer status without raw payloads", () => {
  const timestamp = 10_000;
  ingestLiveVisionFrame(parseLiveVisionFrameInput({
    frameId: "summary-frame",
    source: "capture",
    timestamp,
    screen: "live_hud",
    confidence: 0.9,
    regions: { minimap: { mean: 30, contrast: 44, changed: 12, active: true } },
    minimapMarkers: [
      { id: "enemy-1", side: "enemy", markerClass: "ultralytics-yolo", minimap: [0.7, 0.3], confidence: 0.91 },
    ],
    signals: {
      timerFacts: [
        { timerType: "lord_respawn_timer", text: "0:31", seconds: 31, confidence: 0.9, source: "timer-ocr", confirmedAt: timestamp },
      ],
      screenTextFacts: [
        { region: "top_hud", text: "12:08", confidence: 0.7, rect: [0.1, 0.1, 0.2, 0.1], words: [], source: "paddleocr-screen", observedAt: timestamp },
      ],
    },
  }));

  const fresh = getLatestLiveVisionObservation(timestamp + 1000);
  assert.equal(fresh.available, true);
  assert.equal(fresh.connected, true);
  assert.equal(fresh.stale, false);
  assert.equal(fresh.confidence, "high");
  assert.equal(fresh.minimap.recognized, true);
  assert.equal(fresh.minimap.visibleEnemies, 1);
  assert.equal(fresh.objectiveTimers.recognized, true);
  assert.deepEqual(fresh.objectiveTimers.timerTypes, ["lord_respawn_timer"]);
  assert.equal("regions" in fresh, false);
  assert.equal("signals" in fresh, false);

  const stale = getLatestLiveVisionObservation(timestamp + 7000);
  assert.equal(stale.connected, false);
  assert.equal(stale.stale, true);
  assert.equal(stale.confidence, "low");
  assert.equal(stale.warning, "CV observation stale");
});
