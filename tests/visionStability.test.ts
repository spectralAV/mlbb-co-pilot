import assert from "node:assert/strict";
import { test } from "node:test";
import {
  frameHasDraftYoloEvidence,
  requiredStableFrames,
} from "../frontend/src/runtime/visionStability.ts";

test("frameHasDraftYoloEvidence detects draft yolo hints", () => {
  assert.equal(frameHasDraftYoloEvidence(["yolo draft_screen 0.8"]), true);
  assert.equal(frameHasDraftYoloEvidence(["no signal"]), false);
});

test("requiredStableFrames holds draft longer against unknown flicker", () => {
  assert.equal(requiredStableFrames("draft", "unknown", 0.3), 6);
  assert.equal(requiredStableFrames("draft", "live_hud", 0.8), 4);
});

test("requiredStableFrames enters draft faster with yolo evidence", () => {
  assert.equal(requiredStableFrames("unknown", "draft", 0.65, ["yolo ally_pick_slot"]), 2);
  assert.equal(requiredStableFrames("unknown", "draft", 0.65, []), 3);
});

