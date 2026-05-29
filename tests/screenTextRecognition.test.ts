import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeScreenOcrRegions, normalizeScreenTextFacts } from "../backend/src/vision/screenTextRecognition.ts";

test("screen OCR regions accept active calibration maps", () => {
  const regions = normalizeScreenOcrRegions({
    scoreboard_norm: [[0.31, 0, 0.38, 0.08]],
    equipment_window_norm: [[0.1, 0.13, 0.8, 0.78]],
    bad_region: [2, 0, 1, 1],
  });
  assert.deepEqual(regions.map((region) => region.key), ["top_hud", "scoreboard_modal"]);
  assert.deepEqual(regions[0].rect, [0.31, 0, 0.38, 0.08]);
});

test("screen OCR facts are normalized without trusting empty regions", () => {
  const facts = normalizeScreenTextFacts([
    {
      key: "top_hud",
      rect: [0.32, 0, 0.36, 0.08],
      text: "  08:42   12 - 9 ",
      confidence: 0.87,
      candidates: [{ text: "08:42", confidence: 0.9 }, { text: "", confidence: 0.8 }],
    },
    { key: "broken", rect: [9, 9, 1, 1], text: "ignore", confidence: 1 },
  ], 1234);
  assert.equal(facts.length, 1);
  assert.equal(facts[0].source, "paddleocr-screen");
  assert.equal(facts[0].text, "08:42 12 - 9");
  assert.equal(facts[0].observedAt, 1234);
  assert.deepEqual(facts[0].words.map((word) => word.text), ["08:42"]);
});
