import assert from "node:assert/strict";
import { test } from "node:test";
import { recommendBattleSpells } from "../backend/src/engines/battleSpellEngine.ts";
import { scoreDraftHero } from "../backend/src/engines/scoreHero.ts";
import { getBattleSpellRecognitionManifest } from "../backend/src/vision/battleSpellRecognition.ts";
import { getEquipmentRecognitionManifest } from "../backend/src/vision/equipmentRecognition.ts";
import { getLaneRecognitionManifest } from "../backend/src/vision/laneRecognition.ts";

test("spell recommendation prioritizes Purify for non-jungle carry against hard control", () => {
  const result = recommendBattleSpells({
    selectedLane: "gold",
    enemies: [{ semantic_tags: ["cc", "burst"] }],
    allySpells: [{ slot: 3, spell: "Flicker", confidence: 0.92 }],
    selfSlot: 3,
  });
  assert.equal(result.detectedSelfSpell, "Flicker");
  assert.equal(result.recommendations[0].spell, "Purify");
});

test("spell recommendation requires Retribution for jungle even against control", () => {
  const result = recommendBattleSpells({
    selectedLane: "jungle",
    enemies: [{ semantic_tags: ["cc"] }],
  });
  assert.equal(result.recommendations[0].spell, "Retribution");
});

test("hero scoring favors comfort heroes that fit a detected lane", () => {
  const goldComfort = scoreDraftHero(
    { name: "Lesley", lanes: ["Gold Lane"], roles: ["Marksman"] },
    { allies: [], enemies: [], heroPool: ["Lesley"], lane: "gold", laneDetected: true },
  );
  const wrongLane = scoreDraftHero(
    { name: "Balmond", lanes: ["Jungle"], roles: ["Fighter"] },
    { allies: [], enemies: [], heroPool: ["Lesley"], lane: "gold", laneDetected: true },
  );
  assert.equal(goldComfort.score > wrongLane.score, true);
  assert.equal(goldComfort.reasons[0], "Fits detected gold lane");
  assert.match(wrongLane.risks[0], /does not match detected gold lane/i);
});

test("draft auxiliary recognition is backed by installed-game atlas references", () => {
  const lanes = getLaneRecognitionManifest();
  const spells = getBattleSpellRecognitionManifest();
  assert.match(lanes.source, /Atlas_ChooseLane02_add/);
  assert.deepEqual(lanes.lanes.map((lane) => lane.key), ["exp", "mid", "roam", "jungle", "gold"]);
  assert.equal(lanes.lanes[4]?.texture, "Atlas_ChooseLane02_add/sprites/LaneIcon05.png");
  assert.match(spells.source, /Atlas_SkillIcon/);
  assert.equal(spells.spells.find((spell) => spell.name === "Flicker")?.texture, "Atlas_SkillIcon/sprites/S20100.png");
  assert.deepEqual(spells.unsupportedUntilVerified, ["Arrival"]);
});

test("equipment recognition includes installed-game anti-sustain references", () => {
  const names = getEquipmentRecognitionManifest().items.map((item) => item.name);
  assert.ok(names.includes("Dominance Ice"));
  assert.ok(names.includes("Sea Halberd"));
  assert.ok(names.includes("Glowing Wand"));
});
