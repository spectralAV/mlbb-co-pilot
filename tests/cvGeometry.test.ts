import assert from "node:assert/strict";
import test from "node:test";
import { normalizeReviewRect } from "../frontend/src/utils/cvGeometry";

test("CV review rectangles are clipped to the normalized frame", () => {
  assert.deepEqual(normalizeReviewRect([0.8, 0.9, 0.4, 0.2]), [0.8, 0.9, 0.2, 0.1]);
  assert.deepEqual(normalizeReviewRect([-0.1, -0.2, 0.25, 0.5]), [0, 0, 0.15, 0.3]);
});

test("CV review rectangles reject non-finite and off-frame boxes", () => {
  assert.equal(normalizeReviewRect([1.2, 0.2, 0.1, 0.1]), null);
  assert.equal(normalizeReviewRect([0.2, 0.2, -0.1, 0.1]), null);
  assert.equal(normalizeReviewRect([0.2, Number.NaN, 0.1, 0.1]), null);
  assert.equal(normalizeReviewRect([0.2, 0.2, 0, 0.1]), null);
});
