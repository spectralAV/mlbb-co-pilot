import assert from "node:assert/strict";
import { test } from "node:test";
import { analyzeGankRisk } from "../frontend/src/lib/gankRiskEngine.ts";
import { defaultGameState, type GameState } from "../frontend/src/lib/gameTypes.ts";
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
