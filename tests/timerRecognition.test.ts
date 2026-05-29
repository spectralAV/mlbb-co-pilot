import assert from "node:assert/strict";
import { test } from "node:test";
import { parseTimerValue, resetTimerRecognition, stabilizeTimerCandidate } from "../backend/src/vision/timerRecognition.ts";

test("timer parser accepts countdown and score shapes only in their own surfaces", () => {
  assert.deepEqual(parseTimerValue("01:20", "lord_respawn_timer"), { seconds: 80 });
  assert.deepEqual(parseTimerValue("45", "enemy_respawn_timer"), { seconds: 45 });
  assert.deepEqual(parseTimerValue("27", "score_counter"), { value: 27 });
  assert.equal(parseTimerValue("04:71", "lord_respawn_timer"), null);
});

test("timer facts require two temporally consistent OCR reads", () => {
  resetTimerRecognition();
  const first = stabilizeTimerCandidate({
    timerType: "lord_respawn_timer",
    text: "30",
    confidence: 0.88,
    source: "timer-ocr",
    observedAt: 1000,
  });
  const confirmed = stabilizeTimerCandidate({
    timerType: "lord_respawn_timer",
    text: "29",
    confidence: 0.85,
    source: "timer-ocr",
    observedAt: 2000,
  });
  assert.equal(first, null);
  assert.equal(confirmed?.seconds, 29);
  assert.equal(confirmed?.source, "timer-ocr");
});

test("timer facts reject contradictory or weak OCR reads", () => {
  resetTimerRecognition();
  stabilizeTimerCandidate({
    timerType: "enemy_respawn_timer",
    text: "18",
    confidence: 0.9,
    source: "timer-ocr",
    observedAt: 1000,
  });
  assert.equal(stabilizeTimerCandidate({
    timerType: "enemy_respawn_timer",
    text: "51",
    confidence: 0.9,
    source: "timer-ocr",
    observedAt: 1800,
  }), null);
  assert.equal(stabilizeTimerCandidate({
    timerType: "enemy_respawn_timer",
    text: "50",
    confidence: 0.2,
    source: "timer-ocr",
    observedAt: 2500,
  }), null);
});
