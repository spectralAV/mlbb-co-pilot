import assert from "node:assert/strict";
import { test } from "node:test";
import { detectMinimapMarkerCandidatesFromRgba } from "../frontend/src/vision/minimapMarkerDetector.ts";

test("minimap marker candidates preserve cyan ally and red enemy sides", () => {
  const size = 96;
  const rgba = new Uint8ClampedArray(size * size * 4);
  paint(rgba, size, [16, 68, 21, 73], [30, 170, 232]);
  paint(rgba, size, [71, 19, 77, 25], [222, 56, 60]);

  const candidates = detectMinimapMarkerCandidatesFromRgba(rgba, size, size, 123);
  assert.deepEqual(candidates.map((candidate) => candidate.side).sort(), ["ally", "enemy"]);
  assert.ok(candidates.every((candidate) => candidate.markerClass === "team-color-candidate"));
});

test("minimap marker candidates reject tiny single-pixel color noise", () => {
  const size = 96;
  const rgba = new Uint8ClampedArray(size * size * 4);
  paint(rgba, size, [10, 10, 11, 11], [30, 170, 232]);
  assert.deepEqual(detectMinimapMarkerCandidatesFromRgba(rgba, size, size, 123), []);
});

function paint(
  rgba: Uint8ClampedArray,
  width: number,
  rect: [number, number, number, number],
  color: [number, number, number],
) {
  for (let y = rect[1]; y < rect[3]; y += 1) {
    for (let x = rect[0]; x < rect[2]; x += 1) {
      const index = (y * width + x) * 4;
      rgba[index] = color[0];
      rgba[index + 1] = color[1];
      rgba[index + 2] = color[2];
      rgba[index + 3] = 255;
    }
  }
}
