import assert from "node:assert/strict";
import { test } from "node:test";
import { analyzeGankRisk } from "../frontend/src/lib/gankRiskEngine.ts";
import { defaultGameState, type GameState } from "../frontend/src/lib/gameTypes.ts";
import { applyGameEventToState } from "../frontend/src/lib/liveGameEventEffects.ts";
import { getLiveCoaching } from "../frontend/src/lib/liveCoachingEngine.ts";

function stateWith(patch: Partial<GameState> = {}) {
  const state = defaultGameState();
  return {
    ...state,
    objectiveTimers: { turtle: 999, lord: 999, allyBlue: 999, allyRed: 999, enemyBlue: 999, enemyRed: 999 },
    enemyMissing: { jungler: false, roam: false, mid: false },
    lanePressure: { exp: "even", mid: "even", gold: "even" },
    ...patch,
  } as GameState;
}

function coach(state: GameState) {
  return getLiveCoaching(state, analyzeGankRisk(state));
}

test("manual coach prioritizes base defense", () => {
  const state = stateWith({
    mapZones: defaultGameState().mapZones.map((zone) => zone.id === "ally_base" ? { ...zone, status: "danger" } : zone),
  });
  const result = coach(state);
  assert.equal(result.scenarioId, "base_defense");
  assert.equal(result.priority, "urgent");
});

test("manual coach treats close Lord differently when behind", () => {
  const result = coach(stateWith({
    goldState: "behind",
    objectiveTimers: { lord: 42, turtle: 999 },
  }));
  assert.equal(result.scenarioId, "lord_setup");
  assert.equal(result.priority, "urgent");
});

test("manual coach covers critical Gold lane before generic rotation", () => {
  const result = coach(stateWith({
    lanePressure: { exp: "even", mid: "even", gold: "losing" },
    enemyMissing: { jungler: true, roam: true, mid: false },
  }));
  assert.equal(result.scenarioId, "gold_lane_cover");
  assert.equal(result.mode, "defend");
});

test("manual coach uses lead for timed enemy buff invade", () => {
  const result = coach(stateWith({
    goldState: "ahead",
    lanePressure: { exp: "winning", mid: "winning", gold: "winning" },
    objectiveTimers: { turtle: 999, lord: 999, allyBlue: 999, allyRed: 999, enemyBlue: 22, enemyRed: 999 },
  }));
  assert.equal(result.scenarioId, "enemy_buff_invade");
  assert.equal(result.mode, "rotate");
});

test("manual coach stabilizes when behind and no stronger rule fires", () => {
  const result = coach(stateWith({ goldState: "behind" }));
  assert.equal(result.scenarioId, "behind_stabilize");
  assert.equal(result.mode, "farm");
});

test("quick event: enemy jungler top shifts caution to EXP side", () => {
  const state = applyGameEventToState(stateWith(), {
    id: "event-jg-top",
    timestamp: Date.now(),
    type: "enemy_seen",
    label: "Enemy Jungler Top",
    zone: "river_exp",
    confidence: "high",
  });
  const risk = analyzeGankRisk(state);
  const result = getLiveCoaching(state, risk);
  assert.equal(state.lastEnemySeen.jungler, "river_exp");
  assert.ok(["high", "critical"].includes(risk.lanes.exp.risk));
  assert.notEqual(risk.lanes.gold.reasons[0], "Enemy jungler unseen");
  assert.equal(result.scenarioId, "jungler_side_call");
  assert.match(result.mainAction, /Gold side|EXP/);
});

test("quick event: roam missing makes losing Gold a critical cover call", () => {
  const state = applyGameEventToState(stateWith({
    lanePressure: { exp: "even", mid: "even", gold: "losing" },
  }), {
    id: "event-roam-missing",
    timestamp: Date.now(),
    type: "enemy_missing",
    label: "Roam Missing",
    confidence: "high",
  });
  const risk = analyzeGankRisk(state);
  const result = getLiveCoaching(state, risk);
  assert.equal(risk.lanes.gold.risk, "critical");
  assert.equal(result.scenarioId, "gold_lane_cover");
});

test("won fight converts into objective setup when Turtle is soon", () => {
  const state = applyGameEventToState(stateWith({
    objectiveTimers: { turtle: 38, lord: 999, allyBlue: 999, allyRed: 999, enemyBlue: 999, enemyRed: 999 },
    lanePressure: { exp: "even", mid: "winning", gold: "even" },
  }), {
    id: "event-won-fight",
    timestamp: Date.now(),
    type: "fight_won",
    label: "Won Fight",
    confidence: "high",
  });
  const result = coach(state);
  assert.equal(result.scenarioId, "fight_won_conversion");
  assert.match(result.mainAction, /Turtle/);
});

test("death locks coaching into review until reset event", () => {
  const deadState = applyGameEventToState(stateWith(), {
    id: "event-death",
    timestamp: Date.now(),
    type: "death",
    label: "I Died",
    confidence: "high",
  });
  assert.equal(coach(deadState).scenarioId, "death_review");
  const resetState = applyGameEventToState(deadState, {
    id: "event-reset",
    timestamp: Date.now() + 1,
    type: "rotation",
    label: "Reset / Recall",
    zone: "ally_base",
    confidence: "high",
  });
  assert.notEqual(coach(resetState).scenarioId, "death_review");
});

test("enemy buff invade requires priority and visible mid roam", () => {
  const blocked = coach(stateWith({
    goldState: "ahead",
    enemyMissing: { jungler: false, roam: true, mid: false },
    lanePressure: { exp: "winning", mid: "winning", gold: "even" },
    objectiveTimers: { turtle: 999, lord: 999, allyBlue: 999, allyRed: 999, enemyBlue: 22, enemyRed: 999 },
  }));
  assert.notEqual(blocked.scenarioId, "enemy_buff_invade");

  const allowed = coach(stateWith({
    goldState: "ahead",
    lanePressure: { exp: "winning", mid: "winning", gold: "even" },
    objectiveTimers: { turtle: 999, lord: 999, allyBlue: 999, allyRed: 999, enemyBlue: 22, enemyRed: 999 },
  }));
  assert.equal(allowed.scenarioId, "enemy_buff_invade");
});

test("unknown lanes lower confidence and produce a safer call", () => {
  const result = coach(stateWith({
    lanePressure: { exp: "unknown", mid: "unknown", gold: "unknown" },
    objectiveTimers: { turtle: 999, lord: 999, allyBlue: 999, allyRed: 999, enemyBlue: 999, enemyRed: 999 },
  }));
  assert.equal(result.scenarioId, "low_information");
  assert.equal(result.confidence, "low");
  assert.match(result.mainAction, /wait for info|Wait for information|Farm near safe side/i);
});

test("low-confidence CV keeps coaching conservative without exact position claims", () => {
  const result = coach(stateWith({
    lanePressure: { exp: "unknown", mid: "unknown", gold: "unknown" },
    objectiveTimers: { turtle: 999, lord: 999, allyBlue: 999, allyRed: 999, enemyBlue: 999, enemyRed: 999 },
    cv: {
      source: "hybrid",
      connected: true,
      lastObservationAt: Date.now(),
      confidence: "low",
      numericConfidence: 0.32,
      screenType: "live_hud",
      minimapRecognized: false,
      visibleEnemies: 0,
      estimatedEnemyZones: [],
      stale: false,
      warning: "Minimap not confidently recognized"
    }
  }));
  assert.equal(result.scenarioId, "low_information");
  assert.equal(result.confidence, "low");
  assert.match(result.mainAction, /wait for info|Farm near safe side/i);
  assert.doesNotMatch(result.reason, /enemy .* at|gank .* from/i);
});
