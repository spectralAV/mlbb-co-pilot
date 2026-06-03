import assert from "node:assert/strict";
import { test } from "node:test";
import { evaluateLiveReasoning, ingestLiveReasoning } from "../backend/src/engines/liveReasoningEngine.ts";
import {
  evaluateAdvisoryForTest,
  runAdvisoryCoach,
  shouldTriggerAdvisory,
} from "../backend/src/engines/advisoryCoachLane.ts";

test("advisory output is bounded and grounded on fast lane rule", async () => {
  const input = {
    screen: "live_hud",
    confidence: 0.86,
    signals: {
      objectiveName: "Turtle",
      objectiveSpawnsInSec: 42,
      missingEnemyCount: 3,
      riverVision: false,
    },
  };
  const decision = evaluateLiveReasoning(input);
  assert.equal(decision.ruleId, "objective_blind_risk");
  const advisory = await evaluateAdvisoryForTest(input, decision);
  assert.equal(advisory.status, "ready");
  assert.equal(advisory.groundedRuleId, "objective_blind_risk");
  assert.ok(advisory.recommendations.length <= 3);
  assert.ok(advisory.macroNotes.length <= 2);
  assert.ok(advisory.reasoning.includes("objective_blind_risk"));
});

test("advisory skips when fast lane has no tactical context", async () => {
  const input = { screen: "lobby", confidence: 0.9 };
  const decision = evaluateLiveReasoning(input);
  const advisory = await runAdvisoryCoach(input, decision);
  assert.equal(advisory.status, "skipped");
  assert.equal(advisory.recommendations.length, 0);
});

test("shouldTriggerAdvisory on rule and phase changes", () => {
  const base = evaluateLiveReasoning({
    screen: "live_hud",
    confidence: 0.8,
    signals: { phase: "early", goldState: "even" },
  });
  const same = evaluateLiveReasoning({
    screen: "live_hud",
    confidence: 0.8,
    signals: { phase: "early", goldState: "even" },
  });
  assert.equal(shouldTriggerAdvisory(base, same), false);
  const phaseShift = evaluateLiveReasoning({
    screen: "live_hud",
    confidence: 0.8,
    signals: { phase: "late", goldState: "even", matchTimeSeconds: 900 },
  });
  assert.equal(shouldTriggerAdvisory(base, phaseShift), true);
});

test("fast lane is unaffected when advisory path fails", () => {
  const input = {
    screen: "live_hud",
    confidence: 0.83,
    signals: { enemyDeadCount: 2, allyDeadCount: 0 },
  };
  const direct = evaluateLiveReasoning(input);
  const ingested = ingestLiveReasoning(input);
  assert.equal(direct.ruleId, ingested.ruleId);
  assert.equal(direct.callout, ingested.callout);
  assert.equal(ingested.modelVersion, "coach-scenario-v2");
});

test("new v2 rule: turtle early setup", () => {
  const result = evaluateLiveReasoning({
    screen: "live_hud",
    confidence: 0.85,
    signals: {
      phase: "early",
      matchTimeSeconds: 120,
      objectiveName: "Turtle",
      objectiveSpawnsInSec: 45,
    },
  });
  assert.equal(result.ruleId, "turtle_early_setup");
});

test("new v2 rule: roam gank setup on missing roam", () => {
  const result = evaluateLiveReasoning({
    screen: "live_hud",
    confidence: 0.8,
    signals: {
      lanePressure: { gold: "losing" },
      missingEnemies: ["enemy roam"],
    },
  });
  assert.equal(result.ruleId, "roam_gank_setup");
});
