import assert from "node:assert/strict";
import { test } from "node:test";
import {
  expandRailBoxIfNeeded,
  mergeSlotRects,
  resolveDraftSlotRects,
  yoloBoxesForGroup,
} from "../frontend/src/vision/draftYoloSlots.ts";

const rails = {
  allyPicks: { rect: [0, 0.08, 0.16, 0.83] as [number, number, number, number], count: 5, vertical: true },
  enemyPicks: { rect: [0.84, 0.08, 0.16, 0.83] as [number, number, number, number], count: 5, vertical: true },
  allyBans: { rect: [0.04, 0, 0.22, 0.09] as [number, number, number, number], count: 5, vertical: false },
  enemyBans: { rect: [0.74, 0, 0.22, 0.09] as [number, number, number, number], count: 5, vertical: false },
};

test("yoloBoxesForGroup orders ally picks top-to-bottom", () => {
  const boxes = yoloBoxesForGroup("allyPicks", [
    { className: "ally_pick_slot", confidence: 0.9, bbox: [0, 0.5, 0.1, 0.1], center: [0.05, 0.55] },
    { className: "ally_pick_slot", confidence: 0.9, bbox: [0, 0.1, 0.1, 0.1], center: [0.05, 0.15] },
  ]);
  assert.equal(boxes.length, 2);
  assert.ok(boxes[0][1] < boxes[1][1]);
});

test("expandRailBoxIfNeeded splits a tall pick rail into five slots", () => {
  const slots = expandRailBoxIfNeeded("allyPicks", [0, 0.08, 0.16, 0.83]);
  assert.equal(slots.length, 5);
  assert.ok(slots[0][1] < slots[4][1]);
});

test("mergeSlotRects prefers YOLO boxes and fills gaps from fallback", () => {
  const fallback = [
    [0, 0, 0.1, 0.1],
    [0, 0.1, 0.1, 0.1],
    [0, 0.2, 0.1, 0.1],
    [0, 0.3, 0.1, 0.1],
    [0, 0.4, 0.1, 0.1],
  ] as Array<[number, number, number, number]>;
  const yolo = [[0.5, 0.5, 0.08, 0.08] as [number, number, number, number]];
  const { rects, yoloSlotsUsed } = mergeSlotRects(fallback, yolo, 5);
  assert.equal(yoloSlotsUsed, 1);
  assert.deepEqual(rects[0], yolo[0]);
  assert.deepEqual(rects[1], fallback[1]);
});

test("resolveDraftSlotRects uses YOLO bans when provided", () => {
  const resolved = resolveDraftSlotRects(rails, [
    {
      className: "ally_ban_slot",
      confidence: 0.8,
      bbox: [0.05, 0.01, 0.04, 0.07],
      center: [0.07, 0.045],
    },
    {
      className: "ally_ban_slot",
      confidence: 0.82,
      bbox: [0.11, 0.01, 0.04, 0.07],
      center: [0.13, 0.045],
    },
  ]);
  assert.equal(resolved.allyBans.length, 5);
  assert.ok(resolved.allyBans[0][0] < 0.08);
  assert.ok(resolved.allyBans[1][0] > resolved.allyBans[0][0]);
});
