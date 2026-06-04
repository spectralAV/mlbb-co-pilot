import assert from "node:assert/strict";
import { test } from "node:test";
import { evaluateLiveReasoning } from "../backend/src/engines/liveReasoningEngine.ts";

test("llm sidecar coach returns grounded payload when fetch succeeds", async () => {
  const originalFetch = globalThis.fetch;
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

  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        ok: true,
        data: {
          status: "ready",
          advisorId: "test-sidecar",
          groundedRuleId: decision.ruleId,
          reasoning: "Sidecar test",
          recommendations: [{ id: "a", title: "T", action: "Act", horizon: "immediate" }],
          macroNotes: ["note"],
        },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );

  process.env.ADVISORY_COACH_PROVIDER = "llm-sidecar";
  process.env.ADVISORY_SIDECAR_URL = "http://127.0.0.1:8790/advise";

  const { llmSidecarAdvisoryCoach } = await import("../backend/src/engines/llmSidecarAdvisoryCoach.ts");
  const output = await llmSidecarAdvisoryCoach.evaluate({ context: input, decision });
  globalThis.fetch = originalFetch;
  delete process.env.ADVISORY_COACH_PROVIDER;
  delete process.env.ADVISORY_SIDECAR_URL;

  assert.equal(output.status, "ready");
  assert.equal(output.groundedRuleId, "objective_blind_risk");
  assert.equal(output.advisorId, "test-sidecar");
  assert.equal(output.recommendations.length, 1);
});
