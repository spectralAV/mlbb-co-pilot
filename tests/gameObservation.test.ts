import assert from "node:assert/strict";
import { test } from "node:test";
import { gameObservationFromLiveVision, mergeObservationIntoGameState } from "../frontend/src/lib/gameObservation.ts";
import { defaultGameState } from "../frontend/src/lib/gameTypes.ts";

test("CV observation updates objective timers only when confidence is high", () => {
  const state = defaultGameState();
  const low = gameObservationFromLiveVision({
    frameId: "low-timer",
    source: "timer-ocr",
    timestamp: Date.now(),
    screen: "live_hud",
    confidence: 0.8,
    signals: {
      timerFacts: [
        { timerType: "turtle_respawn_timer", seconds: 22, confidence: 0.58, source: "timer-ocr", confirmedAt: Date.now() }
      ]
    }
  });
  assert.equal(mergeObservationIntoGameState(state, low).objectiveTimers.turtle, state.objectiveTimers.turtle);

  const high = gameObservationFromLiveVision({
    frameId: "high-timer",
    source: "timer-ocr",
    timestamp: Date.now(),
    screen: "live_hud",
    confidence: 0.83,
    signals: {
      timerFacts: [
        { timerType: "turtle_respawn_timer", seconds: 22, confidence: 0.88, source: "timer-ocr", confirmedAt: Date.now() }
      ]
    }
  });
  const merged = mergeObservationIntoGameState(state, high);
  assert.equal(merged.objectiveTimers.turtle, 22);
  assert.equal(merged.cv?.objectiveTimersRecognized, true);
  assert.deepEqual(merged.cv?.recognizedObjectiveTimers, ["turtle_respawn_timer"]);
});

test("manual-only fallback keeps disconnected CV status without changing live inputs", () => {
  const state = defaultGameState();
  const merged = mergeObservationIntoGameState(state, null);

  assert.equal(merged.cv?.connected, false);
  assert.equal(merged.cv?.objectiveTimersRecognized, false);
  assert.equal(merged.objectiveTimers.turtle, state.objectiveTimers.turtle);
  assert.deepEqual(merged.lanePressure, state.lanePressure);
});

test("low-confidence CV lowers status but does not invent enemy positions", () => {
  const state = defaultGameState();
  const observation = gameObservationFromLiveVision({
    frameId: "weak-minimap",
    source: "capture",
    timestamp: Date.now(),
    screen: "live_hud",
    confidence: 0.42,
    minimapMarkers: [
      { id: "enemy", side: "enemy", minimap: [0.2, 0.2], confidence: 0.4 }
    ]
  });
  const merged = mergeObservationIntoGameState(state, observation);
  assert.equal(merged.cv?.confidence, "low");
  assert.equal(merged.cv?.minimapRecognized, false);
  assert.deepEqual(merged.cv?.estimatedEnemyZones, []);
  assert.equal(merged.lastEnemySeen.jungler, state.lastEnemySeen.jungler);
});

test("high-confidence minimap observation marks estimated danger zones without assigning exact roles", () => {
  const state = defaultGameState();
  const observation = gameObservationFromLiveVision({
    frameId: "strong-minimap",
    source: "ultralytics-yolo",
    timestamp: Date.now(),
    screen: "live_hud",
    confidence: 0.86,
    minimapMarkers: [
      { id: "enemy", side: "enemy", status: "visible", minimap: [0.25, 0.32], confidence: 0.9, markerClass: "ultralytics-yolo" }
    ]
  });
  const merged = mergeObservationIntoGameState(state, observation);
  assert.equal(merged.cv?.confidence, "high");
  assert.equal(merged.cv?.visibleEnemies, 1);
  assert.ok(merged.cv?.estimatedEnemyZones.includes("river_exp"));
  assert.equal(merged.mapZones.find((zone) => zone.id === "river_exp")?.status, "danger");
  assert.equal(merged.lastEnemySeen.jungler, state.lastEnemySeen.jungler);
});

test("death replay CV creates a CV-sourced review event only at high confidence", () => {
  const state = defaultGameState();
  const observation = gameObservationFromLiveVision({
    frameId: "death-frame",
    source: "capture",
    timestamp: Date.now(),
    screen: "death_replay",
    confidence: 0.81
  });
  const merged = mergeObservationIntoGameState(state, observation);
  assert.equal(merged.mode, "review");
  assert.equal(merged.events[0]?.source, "cv");
  assert.equal(merged.events[0]?.type, "death");
});

test("stale CV is marked stale and does not overwrite manual timers", () => {
  const state = defaultGameState();
  const observation = gameObservationFromLiveVision({
    frameId: "stale-timer",
    timestamp: Date.now() - 10_000,
    screen: "live_hud",
    confidence: 0.91,
    signals: {
      timerFacts: [
        { timerType: "turtle_respawn_timer", seconds: 5, confidence: 0.91, source: "timer-ocr", confirmedAt: Date.now() - 10_000 }
      ]
    }
  });
  const merged = mergeObservationIntoGameState(state, observation);
  assert.equal(merged.cv?.stale, true);
  assert.equal(merged.cv?.confidence, "low");
  assert.equal(merged.objectiveTimers.turtle, state.objectiveTimers.turtle);
});

test("high-confidence CV can update unknown lane pressure but weak CV cannot", () => {
  const state = {
    ...defaultGameState(),
    lanePressure: { exp: "unknown", mid: "unknown", gold: "losing" }
  };
  const weak = gameObservationFromLiveVision({
    frameId: "weak-lanes",
    timestamp: Date.now(),
    screen: "live_hud",
    confidence: 0.5,
    signals: { lanePressure: { exp: "winning", mid: "winning", gold: "winning" } }
  });
  assert.equal(mergeObservationIntoGameState(state, weak).lanePressure.exp, "unknown");

  const strong = gameObservationFromLiveVision({
    frameId: "strong-lanes",
    timestamp: Date.now(),
    screen: "live_hud",
    confidence: 0.86,
    signals: { lanePressure: { exp: "winning", mid: "even", gold: "winning" } }
  });
  const merged = mergeObservationIntoGameState(state, strong);
  assert.equal(merged.lanePressure.exp, "winning");
  assert.equal(merged.lanePressure.mid, "even");
});
