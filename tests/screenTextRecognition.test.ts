import assert from "node:assert/strict";
import { test } from "node:test";
import {
  mlbbHudOcrRegions,
  normalizeMlbbHudOcrFeedPayload,
  normalizeMlbbHudOcrText,
  normalizeScreenOcrRegions,
  normalizeScreenTextFacts,
  resolveMlbbHudOcrFeedUrls,
  resolveScreenOcrRegions,
} from "../backend/src/vision/screenTextRecognition.ts";

test("screen OCR regions accept active calibration maps", () => {
  const regions = normalizeScreenOcrRegions({
    scoreboard_norm: [[0.31, 0, 0.38, 0.08]],
    equipment_window_norm: [[0.1, 0.13, 0.8, 0.78]],
    bad_region: [2, 0, 1, 1],
  });
  assert.deepEqual(regions.map((region) => region.key), ["top_hud", "scoreboard_modal"]);
  assert.deepEqual(regions[0].rect, [0.31, 0, 0.38, 0.08]);
});

test("MLBB HUD OCR preset stores FalseOCR regions as normalized coordinates", () => {
  const regions = resolveScreenOcrRegions({ profile: "mlbb-hud" });
  assert.deepEqual(regions.map((region) => region.key), [
    "turret1",
    "lord1",
    "gold1",
    "killscore1",
    "timer",
    "killscore2",
    "gold2",
    "turret2",
    "lord2",
  ]);
  assert.deepEqual(mlbbHudOcrRegions[0].rect, [
    Number((665 / 1920).toFixed(6)),
    Number((12 / 1080).toFixed(6)),
    Number((34 / 1920).toFixed(6)),
    Number((36 / 1080).toFixed(6)),
  ]);
});

test("MLBB HUD OCR cleanup stabilizes practical scoreboard text", () => {
  assert.equal(normalizeMlbbHudOcrText("gold1", " 28.8k1 "), "28.8k");
  assert.equal(normalizeMlbbHudOcrText("gold2", "401k"), "40.1k");
  assert.equal(normalizeMlbbHudOcrText("killscore1", "2O"), "20");
  assert.equal(normalizeMlbbHudOcrText("timer", "1O:O8"), "10:08");
});

test("MLBB HUD OCR feed payload is normalized into scoreboard fields", () => {
  const fields = normalizeMlbbHudOcrFeedPayload({
    killscore1: "2O",
    killscore2: "1l",
    gold1: "28.8k1",
    gold2: "401k",
    timer: "1O:O8",
    turret1: "S",
    lord2: "O",
  });
  assert.deepEqual(fields, {
    turret1: "5",
    lord1: "",
    gold1: "28.8k",
    killscore1: "20",
    timer: "10:08",
    killscore2: "11",
    gold2: "40.1k",
    turret2: "",
    lord2: "0",
  });
});

test("MLBB HUD OCR feed probes stable local port candidates", () => {
  assert.deepEqual(resolveMlbbHudOcrFeedUrls(), [
    "http://127.0.0.1:14337/MLBB.json",
    "http://localhost:14337/MLBB.json",
  ]);
});

test("MLBB HUD OCR feed accepts port and URL overrides", () => {
  assert.deepEqual(resolveMlbbHudOcrFeedUrls({ port: "14338" }), [
    "http://127.0.0.1:14338/MLBB.json",
    "http://localhost:14338/MLBB.json",
    "http://127.0.0.1:14337/MLBB.json",
    "http://localhost:14337/MLBB.json",
  ]);
  assert.deepEqual(resolveMlbbHudOcrFeedUrls({ url: "localhost:14339/MLBB.json" })[0], "http://localhost:14339/MLBB.json");
});

test("MLBB HUD OCR facts keep all nine scoreboard fields", () => {
  const facts = normalizeScreenTextFacts(mlbbHudOcrRegions.map((region, index) => ({
    key: region.key,
    text: String(index),
    confidence: 0.9,
    rect: region.rect,
  })));
  assert.equal(facts.length, 9);
  assert.equal(facts.at(-1)?.region, "lord2");
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
