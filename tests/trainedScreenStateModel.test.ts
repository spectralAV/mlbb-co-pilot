import assert from "node:assert/strict";
import test from "node:test";
import { classifyWithTrainedScreenStateModel, type TrainedScreenStateModel } from "../frontend/src/vision/trainedScreenStateModel.ts";

const metric = (mean: number, contrast: number) => ({ mean, contrast, changed: 0, active: false });
const model: TrainedScreenStateModel = {
  version: "test",
  trainedAt: "2026-05-26T00:00:00.000Z",
  featureKeys: Array.from({ length: 12 }, (_, index) => `feature-${index}`),
  normalization: { mean: Array(12).fill(0), scale: Array(12).fill(1) },
  classes: [
    { label: "draft", centroid: Array(12).fill(10), acceptanceDistance: 2, trainingExamples: 2 },
    { label: "loading", centroid: Array(12).fill(20), acceptanceDistance: 2, trainingExamples: 2 },
    { label: "live_hud", centroid: Array(12).fill(30), acceptanceDistance: 2, trainingExamples: 2 },
  ],
  validation: { examples: 3, correct: 3, accuracy: 1 },
};

test("trained screen-state model accepts an in-distribution state", () => {
  const result = classifyWithTrainedScreenStateModel(model, { minimap: metric(10, 10) }, {
    top_hud: metric(10, 10),
    draft_left_rail: metric(10, 10),
    draft_right_rail: metric(10, 10),
    center_panel: metric(10, 10),
    modal_body: metric(10, 10),
  });
  assert.equal(result?.screen, "draft");
  assert.equal(result?.accepted, true);
});

test("trained screen-state model rejects a distant unknown frame", () => {
  const result = classifyWithTrainedScreenStateModel(model, { minimap: metric(50, 50) }, {
    top_hud: metric(50, 50),
    draft_left_rail: metric(50, 50),
    draft_right_rail: metric(50, 50),
    center_panel: metric(50, 50),
    modal_body: metric(50, 50),
  });
  assert.equal(result?.accepted, false);
});
