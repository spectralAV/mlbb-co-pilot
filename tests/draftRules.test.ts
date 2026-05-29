import assert from "node:assert/strict";
import { test } from "node:test";
import { recommendBattleSpells } from "../backend/src/engines/battleSpellEngine.ts";
import { recommendJunglers } from "../backend/src/engines/junglerDraftEngine.ts";
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

test("jungler recommendations favor utility jungle when team lacks control", () => {
  const heroes = [
    {
      id: 1,
      name: "Fredrinn",
      roles: ["Fighter", "Tank"],
      lanes: ["Jungle"],
      specialties: ["Control", "Regen"],
      semantic_tags: ["frontline", "cc", "sustain"]
    },
    {
      id: 2,
      name: "Aamon",
      roles: ["Assassin"],
      lanes: ["Jungle"],
      specialties: ["Chase", "Magic Damage"],
      semantic_tags: ["burst", "mobility", "magic-damage", "dive"]
    }
  ];
  const enemies = [
    { id: 10, name: "Fanny", roles: ["Assassin"], lanes: ["Jungle"], semantic_tags: ["mobility", "dive"] },
    { id: 11, name: "Layla", roles: ["Marksman"], lanes: ["Gold Lane"], semantic_tags: ["burst"] }
  ];

  const result = recommendJunglers(heroes, {
    allies: [],
    enemies,
    unavailable: new Set(),
    heroPool: [],
    selectedLane: "jungle",
    laneDetected: true,
    runtimeByName: new Map()
  });

  assert.equal(result[0]?.hero, "Fredrinn");
  assert.equal(result[0]?.style, "utility");
  assert.equal(result[0]?.boots.blessing, "Bloody");
  assert.ok(result[0]?.reasons.some((reason) => /crowd control/i.test(reason)));
});

test("jungler recommendations expose runtime matchup risks", () => {
  const heroes = [
    {
      id: 109,
      name: "Aamon",
      roles: ["Assassin"],
      lanes: ["Jungle"],
      specialties: ["Chase", "Magic Damage"],
      semantic_tags: ["burst", "mobility", "magic-damage", "dive"]
    },
    {
      id: 8,
      name: "Karina",
      roles: ["Assassin"],
      lanes: ["Jungle"],
      specialties: ["Finisher", "Magic Damage"],
      semantic_tags: ["burst", "magic-damage"]
    }
  ];
  const enemies = [{ id: 9, name: "Akai", roles: ["Tank"], lanes: ["Roam"], semantic_tags: ["frontline", "cc"] }];
  const runtimeByName = new Map([
    ["aamon", { id: 109, name: "Aamon", relations: { weak: [9] } }],
    ["akai", { id: 9, name: "Akai" }]
  ]);

  const result = recommendJunglers(heroes, {
    allies: [],
    enemies,
    unavailable: new Set(),
    heroPool: [],
    selectedLane: "jungle",
    laneDetected: true,
    runtimeByName
  });
  const aamon = result.find((item) => item.hero === "Aamon");

  assert.equal(aamon?.warningLevel, "high");
  assert.ok(aamon?.risks.some((risk) => /Akai/i.test(risk)));
  assert.ok((aamon?.breakdown.relations ?? 0) < 0);
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
