import assert from "node:assert/strict";
import { test } from "node:test";
import { selectLayoutProfile } from "../frontend/src/runtime/captureRuntime.ts";

test("capture runtime selects common phone and video layout profiles from frame aspect", () => {
  assert.equal(selectLayoutProfile(2400, 1080).id, "phone_20_9");
  assert.equal(selectLayoutProfile(1920, 1080).id, "video_16_9");
  assert.equal(selectLayoutProfile(2048, 1536).id, "tablet_4_3");
});

test("capture runtime falls back to custom for uncommon aspect ratios", () => {
  const profile = selectLayoutProfile(1000, 1000);
  assert.equal(profile.id, "custom");
  assert.equal(profile.sourceWidth, 1000);
  assert.equal(profile.sourceHeight, 1000);
});
