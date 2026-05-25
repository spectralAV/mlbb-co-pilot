import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { getMatchState, resetMatchState, updateMatchDraft, updateMatchVision } from "../backend/src/state/matchState.ts";

const draftFixture = JSON.parse(
  readFileSync(new URL("./fixtures/match-state-draft.json", import.meta.url), "utf8"),
);

test("match state stores only confident detector-owned draft facts", () => {
  resetMatchState();
  updateMatchDraft(draftFixture);
  const state = getMatchState();
  assert.equal(state.confidence.draftTrusted, true);
  assert.deepEqual(state.draft?.allyPicks.map((slot) => slot.heroName), ["Confirmed"]);
  assert.deepEqual(state.draft?.enemyPicks, []);
  assert.equal(state.draft?.analysis, null);
});

test("match state accepts analysis only when all submitted facts pass the gate", () => {
  resetMatchState();
  updateMatchDraft({
    state: {
      phase: "pick",
      allyPicks: [{ heroId: 11, heroName: "Confirmed", confidence: 0.92, source: "draft-slot" }],
    },
    analysis: { bestPick: { hero: "Confirmed Counter", score: 83 } },
  });
  assert.equal((getMatchState().draft?.analysis as any).bestPick.hero, "Confirmed Counter");
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
