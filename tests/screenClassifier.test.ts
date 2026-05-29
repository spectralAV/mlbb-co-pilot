import assert from "node:assert/strict";
import { test } from "node:test";
import {
  classifyVisionFrame,
  createVisionStabilityState,
  emptyMetrics,
  resolveWindowContentCrop,
  stabilizeVisionFrame,
  type LiveVisionFrame,
  type RegionMetrics,
  type VisionScreenState
} from "../frontend/src/runtime/captureRuntime.ts";

function probe(mean: number, contrast: number): RegionMetrics {
  return { mean, contrast, changed: 0, active: false };
}

function vision(screen: VisionScreenState, confidence: number): LiveVisionFrame {
  return { screen, confidence, evidence: [screen], timestamp: Date.now() };
}

test("window content crop excludes browser toolbar and sharing banner from CV surface", () => {
  const cropped = resolveWindowContentCrop(1800, 1080, { enabled: true, top: 0.13, right: 0, bottom: 0.06, left: 0 });
  assert.deepEqual(cropped, { x: 0, y: 140, width: 1800, height: 875 });
  assert.deepEqual(
    resolveWindowContentCrop(1800, 1080, { enabled: false, top: 0.13, right: 0, bottom: 0.06, left: 0 }),
    { x: 0, y: 0, width: 1800, height: 1080 }
  );
});

test("screen classifier accepts dark high-contrast draft rails with context markers", () => {
  const metrics = emptyMetrics();
  metrics.minimap = probe(55, 43);
  const state = classifyVisionFrame(metrics, {
    top_hud: probe(67, 38),
    draft_left_rail: probe(52, 50),
    draft_right_rail: probe(33, 32),
    center_panel: probe(76, 56),
    modal_body: probe(50, 48),
  }, [], true);
  assert.equal(state.screen, "draft");
});

test("screen classifier does not turn a bright live HUD into draft from color noise", () => {
  const metrics = emptyMetrics();
  metrics.minimap = probe(98, 33);
  const state = classifyVisionFrame(metrics, {
    top_hud: probe(81, 37),
    draft_left_rail: probe(95, 33),
    draft_right_rail: probe(94, 35),
    center_panel: probe(92, 31),
    modal_body: probe(90, 34),
  }, [], true);
  assert.equal(state.screen, "live_hud");
});

test("screen classifier keeps populated late draft rails ahead of the decorative draft minimap", () => {
  const metrics = emptyMetrics();
  metrics.minimap = probe(54, 40);
  const state = classifyVisionFrame(metrics, {
    top_hud: probe(62, 35),
    draft_left_rail: probe(58, 45),
    draft_right_rail: probe(47, 44),
    center_panel: probe(70, 53),
    modal_body: probe(50, 36),
  }, [], false);
  assert.equal(state.screen, "draft");
});

test("screen classifier keeps completed bright portrait rails in draft instead of live HUD", () => {
  const metrics = emptyMetrics();
  metrics.minimap = probe(94.7, 36.0);
  const state = classifyVisionFrame(metrics, {
    top_hud: probe(74.2, 35.6),
    draft_left_rail: probe(86.3, 28.4),
    draft_right_rail: probe(99.1, 40.0),
    center_panel: probe(79.4, 30.3),
    modal_body: probe(88.6, 34.5),
  }, [], false);
  assert.equal(state.screen, "draft");
});

test("screen classifier keeps the recorded enemy-selection screen in draft despite its decorative minimap", () => {
  const metrics = emptyMetrics();
  metrics.minimap = probe(69.72, 51.55);
  const state = classifyVisionFrame(metrics, {
    top_hud: probe(24.77, 31.45),
    draft_left_rail: probe(54.08, 40.2),
    draft_right_rail: probe(54.45, 44.59),
    center_panel: probe(47.08, 29.72),
    modal_body: probe(50.83, 34.24),
  }, [], false);
  assert.equal(state.screen, "draft");
});

test("screen classifier rejects the bright lobby friend panels as draft rails", () => {
  const metrics = emptyMetrics();
  metrics.minimap = probe(96.52, 52.47);
  const state = classifyVisionFrame(metrics, {
    top_hud: probe(71.21, 33.38),
    draft_left_rail: probe(85.78, 41.02),
    draft_right_rail: probe(74.25, 46.33),
    center_panel: probe(110.81, 46.47),
    modal_body: probe(72, 39),
  }, [], true);
  assert.equal(state.screen, "lobby");
});

test("screen classifier recognizes the recorded equipment scoreboard modal", () => {
  const metrics = emptyMetrics();
  metrics.minimap = probe(46.31, 29.59);
  metrics.equipment_window = probe(55.66, 37.86);
  metrics.attributes_window = probe(55.66, 37.86);
  const state = classifyVisionFrame(metrics, {
    top_hud: probe(18.59, 10.54),
    draft_left_rail: probe(48.94, 32.18),
    draft_right_rail: probe(48.79, 36.87),
    center_panel: probe(55.16, 34.11),
    modal_body: probe(55.66, 37.86),
  }, [], true);
  assert.equal(state.screen, "scoreboard");
});

test("screen classifier recognizes the recorded attributes scoreboard modal", () => {
  const metrics = emptyMetrics();
  metrics.minimap = probe(41.8, 22.13);
  metrics.equipment_window = probe(50.59, 33.03);
  metrics.attributes_window = probe(50.59, 33.03);
  const state = classifyVisionFrame(metrics, {
    top_hud: probe(18.63, 10.56),
    draft_left_rail: probe(46.09, 27.39),
    draft_right_rail: probe(47.03, 35.61),
    center_panel: probe(51.57, 27.56),
    modal_body: probe(50.59, 33.03),
  }, [], true);
  assert.equal(state.screen, "scoreboard");
});

test("live screen stability ignores a single draft-like frame during gameplay", () => {
  const stability = createVisionStabilityState();
  stabilizeVisionFrame(vision("live_hud", 0.74), stability);
  const confirmedLive = stabilizeVisionFrame(vision("live_hud", 0.74), stability);
  const noisyDraft = stabilizeVisionFrame(vision("draft", 0.78), stability);

  assert.equal(confirmedLive.screen, "live_hud");
  assert.equal(noisyDraft.screen, "live_hud");

  const confirmedDraft = stabilizeVisionFrame(vision("draft", 0.78), stability);
  assert.equal(confirmedDraft.screen, "draft");
});

test("live screen stability does not clear a confirmed draft on transient unknown frames", () => {
  const stability = createVisionStabilityState();
  stabilizeVisionFrame(vision("draft", 0.78), stability);
  stabilizeVisionFrame(vision("draft", 0.78), stability);

  for (let index = 0; index < 5; index += 1) {
    assert.equal(stabilizeVisionFrame(vision("unknown", 0.2), stability).screen, "draft");
  }
  assert.equal(stabilizeVisionFrame(vision("unknown", 0.2), stability).screen, "unknown");
});

test("live screen stability requires repeated scoreboard evidence before changing scenes", () => {
  const stability = createVisionStabilityState();
  stabilizeVisionFrame(vision("live_hud", 0.74), stability);
  stabilizeVisionFrame(vision("live_hud", 0.74), stability);

  assert.equal(stabilizeVisionFrame(vision("scoreboard", 0.68), stability).screen, "live_hud");
  assert.equal(stabilizeVisionFrame(vision("scoreboard", 0.68), stability).screen, "live_hud");
  assert.equal(stabilizeVisionFrame(vision("scoreboard", 0.68), stability).screen, "scoreboard");
});
