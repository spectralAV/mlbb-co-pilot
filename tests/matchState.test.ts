import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { getMatchState, resetMatchState, updateMatchDraft, updateMatchVision } from "../backend/src/state/matchState.ts";
import { ingestLiveVisionFrame } from "../backend/src/vision/liveVisionState.ts";
import { resetMinimapMonitor } from "../backend/src/vision/minimapMonitor.ts";

const draftFixture = JSON.parse(
  readFileSync(new URL("./fixtures/match-state-draft.json", import.meta.url), "utf8"),
);

test("match state stores only confident detector-owned draft facts", () => {
  resetMatchState();
  updateMatchDraft(draftFixture);
  const state = getMatchState();
  assert.equal(state.confidence.draftTrusted, true);
  assert.deepEqual(state.draft?.allyBans.map((slot) => slot.heroName), ["Confirmed Ban"]);
  assert.deepEqual(state.draft?.allyPicks.map((slot) => slot.heroName), ["Confirmed Pick"]);
  assert.equal(state.draft?.allyPicks[0]?.slot, 3);
  assert.deepEqual(state.draft?.allySpells.map((fact) => fact.spell), ["Flicker"]);
  assert.deepEqual(state.draft?.allyLanes.map((fact) => `${fact.slot}:${fact.lane}`), ["3:gold"]);
  assert.deepEqual(state.draft?.enemyPicks, []);
  assert.equal(state.draft?.selectedLane?.value, "gold");
  assert.equal(state.draft?.selfSlot?.value, 3);
  assert.equal(state.draft?.firstPickSide?.value, "enemy");
  assert.equal(state.draft?.analysis, null);
});

test("match state accepts analysis only when all submitted facts pass the gate", () => {
  resetMatchState();
  updateMatchDraft({
    state: {
      phase: "pick",
      allyPicks: [{ heroId: 14, heroName: "Confirmed Pick", confidence: 0.9, source: "draft-pick-portrait" }],
      allyBans: [{ heroId: 11, heroName: "Confirmed Ban", confidence: 0.92, source: "draft-ban-icon" }],
      allySpells: [{ spell: "Purify", slot: 1, confidence: 0.8, source: "draft-battle-spell-icon" }],
      allyLanes: [{ lane: "gold", slot: 1, confidence: 0.82, source: "draft-lane-icon" }],
    },
    analysis: { bestPick: { hero: "Confirmed Counter", score: 83 } },
  });
  assert.equal((getMatchState().draft?.analysis as any).bestPick.hero, "Confirmed Counter");
  assert.equal(getMatchState().draft?.allySpells[0]?.spell, "Purify");
  assert.equal(getMatchState().draft?.allyLanes[0]?.lane, "gold");
});

test("match state accepts detector-owned pick portraits and rejects pick facts from icon surfaces", () => {
  resetMatchState();
  updateMatchDraft({
    state: {
      phase: "pick",
      allyPicks: [
        { heroId: 21, heroName: "Portrait Pick", confidence: 0.9, source: "draft-pick-portrait" },
        { heroId: 22, heroName: "Wrong Surface", confidence: 0.99, source: "draft-ban-icon" },
      ],
    },
  });
  assert.deepEqual(getMatchState().draft?.allyPicks.map((slot) => slot.heroName), ["Portrait Pick"]);
});

test("draft slot stabilizer waits for repeated medium-confidence agreement", () => {
  resetMatchState();
  updateMatchDraft({
    state: {
      phase: "pick",
      allyPicks: [{ heroId: 31, heroName: "Noisy Pick", slot: 1, confidence: 0.72, source: "draft-pick-portrait" }],
    },
  });
  assert.deepEqual(getMatchState().draft?.allyPicks, []);
  assert.equal(getMatchState().confidence.draftTrusted, false);

  updateMatchDraft({
    state: {
      phase: "pick",
      allyPicks: [{ heroId: 31, heroName: "Noisy Pick", slot: 1, confidence: 0.74, source: "draft-pick-portrait" }],
    },
    analysis: { bestPick: { hero: "Noisy Counter", score: 77 } },
  });
  assert.deepEqual(getMatchState().draft?.allyPicks.map((slot) => slot.heroName), ["Noisy Pick"]);
  assert.equal((getMatchState().draft?.analysis as any).bestPick.hero, "Noisy Counter");
});

test("draft slot stabilizer preserves stable medium-confidence picks through one noisy contradiction", () => {
  resetMatchState();
  for (const confidence of [0.72, 0.74]) {
    updateMatchDraft({
      state: {
        phase: "pick",
        allyPicks: [{ heroId: 31, heroName: "Stable Pick", slot: 1, confidence, source: "draft-pick-portrait" }],
      },
    });
  }
  assert.deepEqual(getMatchState().draft?.allyPicks.map((slot) => slot.heroName), ["Stable Pick"]);

  updateMatchDraft({
    state: {
      phase: "pick",
      allyPicks: [{ heroId: 32, heroName: "Noisy Contradiction", slot: 1, confidence: 0.73, source: "draft-pick-portrait" }],
    },
  });
  assert.deepEqual(getMatchState().draft?.allyPicks.map((slot) => slot.heroName), ["Stable Pick"]);
});

test("draft slot stabilizer locks high-confidence picks until repeated contradiction", () => {
  resetMatchState();
  updateMatchDraft({
    state: {
      phase: "pick",
      enemyPicks: [{ heroId: 41, heroName: "Locked Pick", slot: 2, confidence: 0.92, source: "draft-pick-portrait" }],
    },
  });
  assert.deepEqual(getMatchState().draft?.enemyPicks.map((slot) => slot.heroName), ["Locked Pick"]);

  for (let index = 0; index < 2; index += 1) {
    updateMatchDraft({
      state: {
        phase: "pick",
        enemyPicks: [{ heroId: 42, heroName: "Contradicting Pick", slot: 2, confidence: 0.91, source: "draft-pick-portrait" }],
      },
    });
    assert.deepEqual(getMatchState().draft?.enemyPicks.map((slot) => slot.heroName), ["Locked Pick"]);
  }

  updateMatchDraft({
    state: {
      phase: "pick",
      enemyPicks: [{ heroId: 42, heroName: "Contradicting Pick", slot: 2, confidence: 0.93, source: "draft-pick-portrait" }],
    },
  });
  assert.deepEqual(getMatchState().draft?.enemyPicks.map((slot) => slot.heroName), ["Contradicting Pick"]);
});

test("match state does not trust low-confidence vision reasoning", () => {
  resetMatchState();
  updateMatchVision(
    { screen: "live_hud", confidence: 0.4, source: "fixture", timestamp: Date.now() },
    { ruleId: "objective_setup", confidence: 0.4, scene: "map" },
  );
  assert.equal(getMatchState().confidence.visionTrusted, false);
  assert.equal(getMatchState().confidence.reasoningTrusted, false);
});

test("match state trusts detector-owned draft context without hero identity", () => {
  resetMatchState();
  updateMatchDraft({
    state: {
      phase: "ban",
      selectedLane: { value: "exp", confidence: 0.89, source: "draft-lane-icon" },
      selfSlot: { value: 4, confidence: 0.84, source: "draft-self-highlight" },
      firstPickSide: { value: "ally", confidence: 0.9, source: "draft-first-pick-indicator" },
    },
    analysis: { bestPick: { hero: "Context Counter", score: 71 } },
  });
  const state = getMatchState();
  assert.equal(state.confidence.draftTrusted, true);
  assert.equal(state.draft?.selectedLane?.value, "exp");
  assert.equal(state.draft?.selfSlot?.value, 4);
  assert.equal(state.draft?.firstPickSide?.value, "ally");
  assert.equal(state.draft?.analysis, null);
});

test("match state derives and replaces my lane from the highlighted slot after a role swap", () => {
  resetMatchState();
  updateMatchDraft({
    state: {
      phase: "pick",
      selfSlot: { value: 3, confidence: 0.91, source: "draft-self-highlight" },
      allyLanes: [{ lane: "gold", slot: 3, confidence: 0.88, source: "draft-lane-icon" }],
    },
  });
  assert.equal(getMatchState().draft?.selectedLane?.value, "gold");

  updateMatchDraft({
    state: {
      phase: "pick",
      selfSlot: { value: 4, confidence: 0.9, source: "draft-self-highlight" },
      allyLanes: [{ lane: "exp", slot: 4, confidence: 0.92, source: "draft-lane-icon" }],
    },
  });
  assert.equal(getMatchState().draft?.selfSlot?.value, 4);
  assert.equal(getMatchState().draft?.selectedLane?.value, "exp");
});

test("trusted non-draft vision retires active draft presentation without destroying recorded facts", () => {
  resetMatchState();
  updateMatchDraft(draftFixture);
  updateMatchVision(
    { screen: "live_hud", confidence: 0.72, source: "obs", timestamp: Date.now() },
    { ruleId: "stable_state", confidence: 0.72, scene: "main" },
  );
  const state = getMatchState();
  assert.equal(state.lifecycle?.screen, "live_hud");
  assert.equal(state.confidence.draftTrusted, false);
  assert.deepEqual(state.draft?.allyPicks.map((slot) => slot.heroName), ["Confirmed Pick"]);
});

test("provisional draft context does not erase confirmed detector facts during model warm-up", () => {
  resetMatchState();
  updateMatchDraft(draftFixture);
  updateMatchDraft({
    state: {
      phase: "pick",
      provisional: true,
      selfSlot: { value: 3, confidence: 0.98, source: "draft-self-highlight" },
      firstPickSide: { value: "enemy", confidence: 0.9, source: "draft-first-pick-indicator" },
    },
  });
  const state = getMatchState();
  assert.deepEqual(state.draft?.allyPicks.map((slot) => slot.heroName), ["Confirmed Pick"]);
  assert.deepEqual(state.draft?.allySpells.map((fact) => fact.spell), ["Flicker"]);
  assert.equal(state.draft?.selectedLane?.value, "gold");
});

test("confirmed first-pick side persists after its draft badge is no longer shown", () => {
  resetMatchState();
  updateMatchDraft({
    state: {
      phase: "ban",
      firstPickSide: { value: "ally", confidence: 0.94, source: "draft-first-pick-indicator" },
    },
  });
  updateMatchDraft({
    state: {
      phase: "pick",
      allyPicks: [{ heroName: "Later Pick", slot: 1, confidence: 0.91, source: "draft-pick-portrait" }],
    },
    analysis: { bestPick: { hero: "Later Counter", score: 79 } },
  });
  assert.equal(getMatchState().draft?.firstPickSide?.value, "ally");
  assert.equal((getMatchState().draft?.analysis as any).bestPick.hero, "Later Counter");
});

test("confirmed enemy equipment remains available after the scoreboard closes", () => {
  resetMatchState();
  ingestLiveVisionFrame({
    screen: "scoreboard",
    confidence: 0.82,
    signals: {
      allyEquipment: [
        { itemId: 31052, itemName: "Glowing Wand", side: "ally", row: 3, slot: 2, confidence: 0.87, source: "equipment-item-icon" },
      ],
      enemyEquipment: [
        { itemId: 3206, itemName: "Dominance Ice", side: "enemy", row: 1, slot: 1, confidence: 0.9, source: "equipment-item-icon" },
        { itemId: 3013, itemName: "Sea Halberd", side: "enemy", row: 2, slot: 2, confidence: 0.86, source: "equipment-item-icon" },
      ],
    },
  });
  ingestLiveVisionFrame({
    screen: "live_hud",
    confidence: 0.74,
  });
  assert.deepEqual(getMatchState().vision?.signals?.enemyItems, ["Dominance Ice", "Sea Halberd"]);
  assert.equal(getMatchState().vision?.signals?.enemyEquipment?.[0]?.source, "equipment-item-icon");
  assert.deepEqual(getMatchState().vision?.signals?.allyItems, ["Glowing Wand"]);
  assert.equal(getMatchState().vision?.signals?.teamHasAntiHeal, true);
});

test("ultralytics detections enter live state only as confidence-scored visible facts", () => {
  resetMatchState();
  ingestLiveVisionFrame({
    screen: "live_hud",
    confidence: 0.74,
    minimapMarkers: [
      { id: "enemy-1", side: "enemy", markerClass: "ultralytics-yolo", minimap: [0.6, 0.3], confidence: 0.88 },
    ],
    signals: {
      yoloDetections: [
        { classId: 13, className: "lord", confidence: 0.9, bbox: [0.1, 0.2, 0.08, 0.08], center: [0.14, 0.24], source: "ultralytics-yolo" },
        { classId: 12, className: "turtle", confidence: 0.3, bbox: [0.2, 0.2, 0.08, 0.08], center: [0.24, 0.24], source: "ultralytics-yolo" },
      ],
    },
  });
  const vision = getMatchState().vision;
  assert.equal(vision.minimapMarkers[0].markerClass, "ultralytics-yolo");
  assert.deepEqual(vision.signals.yoloDetections.map((detection: any) => detection.className), ["lord"]);
  assert.equal(vision.signals.yoloDetections[0].source, "ultralytics-yolo");
});

test("minimap monitor keeps missing enemies only as decaying last-seen facts", () => {
  resetMatchState();
  resetMinimapMonitor();
  ingestLiveVisionFrame({
    screen: "live_hud",
    timestamp: 1000,
    confidence: 0.82,
    minimapMarkers: [
      { id: "enemy-visible", side: "enemy", markerClass: "ultralytics-yolo", minimap: [0.55, 0.42], confidence: 0.9 },
    ],
  });
  assert.equal(getMatchState().vision?.signals?.mapMonitor?.markers[0]?.status, "visible");

  ingestLiveVisionFrame({ screen: "live_hud", timestamp: 2200, confidence: 0.8, minimapMarkers: [] });
  const lastSeen = getMatchState().vision?.signals?.mapMonitor;
  assert.equal(lastSeen.lastSeenEnemies, 1);
  assert.equal(lastSeen.markers[0].status, "last_seen");
  assert.equal(lastSeen.markers[0].ageMs, 1200);
  assert.equal(lastSeen.markers[0].confidence < 0.9, true);

  ingestLiveVisionFrame({ screen: "live_hud", timestamp: 7000, confidence: 0.8, minimapMarkers: [] });
  assert.equal(getMatchState().vision?.signals?.mapMonitor?.lastSeenEnemies, 0);
});

test("minimap monitor records visible objectives without creating timer claims", () => {
  resetMatchState();
  resetMinimapMonitor();
  ingestLiveVisionFrame({
    screen: "live_hud",
    timestamp: 3000,
    confidence: 0.84,
    signals: {
      minimapObjects: [
        { objectType: "lord", minimap: [0.51, 0.48], confidence: 0.91, source: "ultralytics-yolo" },
      ],
    },
  });
  const signals = getMatchState().vision?.signals;
  assert.deepEqual(signals.mapMonitor.visibleObjectives, ["lord"]);
  assert.equal(signals.objectiveSpawnsInSec, undefined);
});

test("minimap identities require confidence-scored heroes from the detected draft roster", () => {
  resetMatchState();
  resetMinimapMonitor();
  updateMatchDraft({
    state: {
      phase: "complete",
      allyPicks: [],
      enemyPicks: [{ heroId: 7, heroName: "Alucard", slot: 5, confidence: 0.92, source: "draft-pick-portrait" }],
    },
  });
  ingestLiveVisionFrame({
    screen: "live_hud",
    timestamp: 5000,
    confidence: 0.88,
    minimapMarkers: [
      {
        id: "enemy-identity",
        side: "enemy",
        markerClass: "ultralytics-yolo",
        minimap: [0.62, 0.38],
        confidence: 0.9,
        heroId: 7,
        heroName: "Alucard",
        identityConfidence: 0.87,
        identitySource: "minimap-hero-identity",
      },
    ],
  });
  let marker = getMatchState().vision?.signals?.mapMonitor?.markers[0];
  assert.equal(marker.heroName, "Alucard");
  assert.equal(marker.heroIcon, "/api/vision/heroes/icon/7");
  assert.equal(marker.identitySource, "minimap-hero-identity");

  ingestLiveVisionFrame({ screen: "live_hud", timestamp: 6200, confidence: 0.83, minimapMarkers: [] });
  marker = getMatchState().vision?.signals?.mapMonitor?.markers[0];
  assert.equal(marker.status, "last_seen");
  assert.equal(marker.heroName, "Alucard");
});

test("minimap identities are stripped when not in roster or below detection confidence", () => {
  resetMatchState();
  resetMinimapMonitor();
  updateMatchDraft({
    state: {
      phase: "complete",
      allyPicks: [],
      enemyPicks: [{ heroId: 7, heroName: "Alucard", confidence: 0.92, source: "draft-pick-portrait" }],
    },
  });
  ingestLiveVisionFrame({
    screen: "live_hud",
    confidence: 0.84,
    minimapMarkers: [
      { id: "wrong", side: "enemy", markerClass: "ultralytics-yolo", minimap: [0.4, 0.4], confidence: 0.9, heroId: 3, heroName: "Balmond", identityConfidence: 0.91, identitySource: "minimap-hero-identity" },
      { id: "weak", side: "enemy", markerClass: "ultralytics-yolo", minimap: [0.7, 0.7], confidence: 0.9, heroId: 7, heroName: "Alucard", identityConfidence: 0.31, identitySource: "minimap-hero-identity" },
    ],
  });
  const markers = getMatchState().vision?.signals?.mapMonitor?.markers;
  assert.equal(markers.length, 2);
  assert.equal(markers.every((marker: any) => marker.heroName === undefined), true);
});

test("live state accepts only confirmed timer facts from the OCR owner", () => {
  resetMatchState();
  ingestLiveVisionFrame({
    screen: "live_hud",
    confidence: 0.86,
    signals: {
      timerFacts: [
        { timerType: "lord_respawn_timer", text: "29", seconds: 29, confidence: 0.82, source: "timer-ocr", confirmedAt: 2000 },
        { timerType: "enemy_respawn_timer", text: "18", seconds: 18, confidence: 0.99, source: "manual", confirmedAt: 2000 },
        { timerType: "turtle_respawn_timer", text: "40", seconds: 40, confidence: 0.2, source: "timer-ocr", confirmedAt: 2000 },
      ],
    },
  });
  const timers = getMatchState().vision?.signals?.timerFacts;
  assert.deepEqual(timers.map((fact: any) => fact.timerType), ["lord_respawn_timer"]);
  assert.equal(timers[0].seconds, 29);
});
