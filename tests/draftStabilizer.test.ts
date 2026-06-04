import assert from "node:assert/strict";
import { test } from "node:test";
import {
  reconcileDuplicateHeroSlots,
  resetDraftSlotStabilizer,
  stabilizeDraftSlotGroup,
  type DraftSlotGroup,
} from "../backend/src/state/draftStabilizer.ts";

test("ban stabilizer does not resurrect a slot missing from the current frame", () => {
  resetDraftSlotStabilizer();
  const first = stabilizeDraftSlotGroup("allyBans", [
    { heroId: 116, heroName: "Gloo", slot: 3, confidence: 0.9, source: "draft-ban-icon" },
  ]);
  assert.equal(first.length, 1);
  const second = stabilizeDraftSlotGroup("allyBans", []);
  assert.equal(second.length, 0);
});

test("pick stabilizer unlocks a slot after repeated swap evidence", () => {
  resetDraftSlotStabilizer();
  stabilizeDraftSlotGroup("allyPicks", [
    { heroId: 38, heroName: "Vexana", slot: 2, confidence: 0.9, source: "draft-pick-portrait" },
  ]);
  stabilizeDraftSlotGroup("allyPicks", [
    { heroId: 22, heroName: "Lesley", slot: 2, confidence: 0.88, source: "draft-pick-portrait" },
  ]);
  stabilizeDraftSlotGroup("allyPicks", [
    { heroId: 22, heroName: "Lesley", slot: 2, confidence: 0.89, source: "draft-pick-portrait" },
  ]);
  const swapped = stabilizeDraftSlotGroup("allyPicks", [
    { heroId: 22, heroName: "Lesley", slot: 2, confidence: 0.88, source: "draft-pick-portrait" },
    { heroId: 38, heroName: "Vexana", slot: 4, confidence: 0.87, source: "draft-pick-portrait" },
  ]);
  const slot2 = swapped.find((entry) => entry.slot === 2);
  const slot4 = swapped.find((entry) => entry.slot === 4);
  assert.equal(slot2?.heroName, "Lesley");
  assert.equal(slot4?.heroName, "Vexana");
});

test("reconcileDuplicateHeroSlots keeps one slot per hero during swap overlap", () => {
  const group: DraftSlotGroup = "allyPicks";
  const merged = reconcileDuplicateHeroSlots(group, [
    { heroId: 38, heroName: "Vexana", slot: 2, confidence: 0.7, source: "draft-pick-portrait" },
    { heroId: 38, heroName: "Vexana", slot: 4, confidence: 0.9, source: "draft-pick-portrait" },
  ], new Set(["allyPicks:4"]));
  assert.equal(merged.length, 1);
  assert.equal(merged[0]?.slot, 4);
});

test("reconcileDuplicateHeroSlots prefers a fresh slot read over stale duplicate memory", () => {
  const group: DraftSlotGroup = "allyPicks";
  const merged = reconcileDuplicateHeroSlots(group, [
    { heroId: 53, heroName: "Lesley", slot: 2, confidence: 0.88, source: "draft-pick-portrait" },
    { heroId: 53, heroName: "Lesley", slot: 4, confidence: 0.9, source: "draft-pick-portrait" },
  ], new Set(["allyPicks:2"]));
  assert.equal(merged.length, 1);
  assert.equal(merged[0]?.slot, 2);
});
