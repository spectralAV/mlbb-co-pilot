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

test("hero scoring uses RONE hero performance and rank profile", () => {
  const hero = { name: "Aamon", lanes: ["Jungle"], roles: ["Assassin"], semantic_tags: ["burst", "mobility"] };
  const strongRone = scoreDraftHero(hero, {
    allies: [],
    enemies: [],
    heroPool: [],
    lane: "jungle",
    laneDetected: true,
    rankProfile: "Mythical Glory 52 stars",
    heroPerformance: [{ hero: "Aamon", matches: 34, wins: 24, winRate: 70.6, bestScore: 850, source: "rone" }],
    runtimeHero: { meta: { winRate: 56, appearanceRate: 12 } },
  });
  const weakRone = scoreDraftHero(hero, {
    allies: [],
    enemies: [],
    heroPool: [],
    lane: "jungle",
    laneDetected: true,
    rankProfile: "Mythical Glory 52 stars",
    heroPerformance: [{ hero: "Aamon", matches: 34, wins: 13, winRate: 38.2, bestScore: 610, source: "rone" }],
    runtimeHero: { meta: { winRate: 56, appearanceRate: 12 } },
  });

  assert.equal(strongRone.score > weakRone.score, true);
  assert.ok(strongRone.reasons.some((reason) => /RONE profile: 34 matches \/ 8\.5 grade \/ 70\.6% WR/i.test(reason)));
  assert.ok(weakRone.risks.some((risk) => /RONE profile grade is only 6\.1/i.test(risk)));
});

test("hero scoring treats average grade as stronger than raw win rate", () => {
  const hero = { name: "Aamon", lanes: ["Jungle"], roles: ["Assassin"], semantic_tags: ["burst", "mobility"] };
  const highGradeLowWinRate = scoreDraftHero(hero, {
    allies: [],
    enemies: [],
    heroPool: [],
    lane: "jungle",
    laneDetected: true,
    heroPerformance: [{ hero: "Aamon", matches: 32, wins: 15, winRate: 46.9, averageGrade: 9.3, source: "rone" }],
  });
  const lowGradeHighWinRate = scoreDraftHero(hero, {
    allies: [],
    enemies: [],
    heroPool: [],
    lane: "jungle",
    laneDetected: true,
    heroPerformance: [{ hero: "Aamon", matches: 32, wins: 25, winRate: 78.1, averageGrade: 6.9, source: "rone" }],
  });

  assert.equal(highGradeLowWinRate.score > lowGradeHighWinRate.score, true);
  assert.ok(highGradeLowWinRate.reasons.some((reason) => /9\.3 grade \/ 46\.9% WR/i.test(reason)));
});

test("hero scoring prefers current-season RONE form over weak overall history", () => {
  const currentSeasonForm = scoreDraftHero(
    { name: "Lancelot", lanes: ["Jungle"], roles: ["Assassin"], semantic_tags: ["burst", "mobility"] },
    {
      allies: [],
      enemies: [],
      heroPool: [],
      lane: "jungle",
      laneDetected: true,
      heroPerformance: [
        { hero: "Lancelot", matches: 18, wins: 13, winRate: 72.2, bestScore: 910, source: "rone", scope: "current-season", seasonId: 37 },
        { hero: "Lancelot", matches: 140, wins: 66, winRate: 47.1, bestScore: 760, source: "rone", scope: "overall" },
      ],
    },
  );

  assert.ok(currentSeasonForm.reasons.some((reason) => /RONE current season: 18 matches \/ 9\.1 grade \/ 72\.2% WR/i.test(reason)));
  assert.ok(currentSeasonForm.reasons.some((reason) => /overrides 7\.6 overall grade/i.test(reason)));
  assert.equal(currentSeasonForm.risks.some((risk) => /47\.1% WR/i.test(risk)), false);
});

test("hero scoring falls back to overall RONE mechanics when current season is missing", () => {
  const overallOnly = scoreDraftHero(
    { name: "Fanny", lanes: ["Jungle"], roles: ["Assassin"], semantic_tags: ["mobility", "dive"] },
    {
      allies: [],
      enemies: [],
      heroPool: [],
      lane: "jungle",
      laneDetected: true,
      heroPerformance: [
        { hero: "Fanny", matches: 95, wins: 65, winRate: 68.4, bestScore: 920, source: "rone", scope: "overall" },
      ],
    },
  );
  const noRone = scoreDraftHero(
    { name: "Fanny", lanes: ["Jungle"], roles: ["Assassin"], semantic_tags: ["mobility", "dive"] },
    { allies: [], enemies: [], heroPool: [], lane: "jungle", laneDetected: true },
  );

  assert.equal(overallOnly.score > noRone.score, true);
  assert.ok(overallOnly.reasons.some((reason) => /RONE overall mechanics: 95 matches \/ 9\.2 grade \/ 68\.4% WR/i.test(reason)));
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

test("jungler recommendations apply RONE frequent-hero performance", () => {
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

  const result = recommendJunglers(heroes, {
    allies: [],
    enemies: [],
    unavailable: new Set(),
    heroPool: [],
    selectedLane: "jungle",
    laneDetected: true,
    runtimeByName: new Map(),
    heroPerformance: [{ hero: "Karina", matches: 42, wins: 31, winRate: 73.8, bestScore: 870, source: "rone" }],
    rankProfile: "Mythical Honor 31 stars"
  });

  assert.equal(result[0]?.hero, "Karina");
  assert.ok(result[0]?.reasons.some((reason) => /RONE profile: 42 matches \/ 8\.7 grade \/ 73\.8% WR/i.test(reason)));
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
