import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeAnnotationBoxes } from "../backend/src/vision/cvAnnotation.ts";

test("CV annotations retain hero identity metadata only for minimap hero boxes", () => {
  const boxes = normalizeAnnotationBoxes([
    { classId: 11, rect: [0.1, 0.2, 0.1, 0.1], heroId: 7, heroName: "Alucard" },
    { classId: 13, rect: [0.3, 0.3, 0.1, 0.1], heroId: 7, heroName: "Alucard" },
    { classId: 10, rect: [0.5, 0.5, 0.1, 0.1], heroId: "invalid", heroName: "Karina" },
  ]);

  assert.deepEqual({ heroId: boxes[0].heroId, heroName: boxes[0].heroName }, { heroId: 7, heroName: "Alucard" });
  assert.equal(boxes[1].heroId, undefined);
  assert.equal(boxes[2].heroName, undefined);
});

test("CV annotations retain validated timer transcripts without altering detector labels", () => {
  const boxes = normalizeAnnotationBoxes([
    { classId: 17, rect: [0.1, 0.1, 0.2, 0.1], transcript: "01:20" },
    { classId: 18, rect: [0.1, 0.3, 0.2, 0.1], transcript: "43" },
    { classId: 21, rect: [0.1, 0.5, 0.2, 0.1], transcript: "abc" },
  ]);

  assert.equal(boxes[0].transcript, "01:20");
  assert.equal(boxes[1].transcript, "43");
  assert.equal(boxes[2].transcript, undefined);
  assert.deepEqual(boxes.map((box) => box.className), ["lord_respawn_timer", "enemy_respawn_timer", "score_counter"]);
});
