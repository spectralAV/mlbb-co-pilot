import assert from "node:assert/strict";
import { test } from "node:test";
import { resetMatchState } from "../backend/src/state/matchState.ts";
import { ingestLiveVisionFrame } from "../backend/src/vision/liveVisionState.ts";
import {
  flushVisionReflections,
  getVisionReflectionSummary,
  recordVisionReflection,
  resetVisionReflections,
} from "../backend/src/vision/visionReflection.ts";

test("vision reflection records low-confidence frames and accepted model facts", async () => {
  resetMatchState();
  await resetVisionReflections();

  ingestLiveVisionFrame({
    source: "reflection-test",
    timestamp: 1000,
    screen: "unknown",
    confidence: 0.2,
    evidence: ["blurred frame"],
  });
  ingestLiveVisionFrame({
    source: "reflection-test",
    timestamp: 2000,
    screen: "live_hud",
    confidence: 0.86,
    evidence: ["YOLO minimap markers: 1"],
    minimapMarkers: [{
      id: "tracked-enemy",
      side: "enemy",
      markerClass: "ultralytics-yolo",
      minimap: [0.5, 0.25],
      confidence: 0.92,
    }],
    signals: {
      yoloDetections: [{
        classId: 11,
        className: "enemy_hero_marker",
        confidence: 0.92,
        bbox: [0.08, 0.08, 0.02, 0.02],
        center: [0.09, 0.09],
        source: "ultralytics-yolo",
        trackId: "yolo-track-enemy-1",
        trackAge: 2,
        trackMissingFrames: 0,
      }],
    },
  });

  await flushVisionReflections();
  const summary = await getVisionReflectionSummary();

  assert.equal(summary.total, 2);
  assert.equal(summary.byOutcome.rejected, 1);
  assert.equal(summary.byOutcome.accepted, 1);
  assert.equal(summary.recent[0].reason, "model_facts_ingested");
  assert.deepEqual(summary.recent[0].labels, ["enemy_hero_marker"]);
});

test("vision reflection summary counts manual ultralytics failures", async () => {
  await resetVisionReflections();
  await recordVisionReflection({
    category: "ultralytics",
    outcome: "failed",
    source: "native-obs-test",
    reason: "worker timeout",
    detectionCount: 0,
  });

  const summary = await getVisionReflectionSummary();

  assert.equal(summary.total, 1);
  assert.equal(summary.byOutcome.failed, 1);
  assert.equal(summary.bySource["native-obs-test"], 1);
  assert.equal(summary.topReasons[0].reason, "worker timeout");
});
