import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { listCoachReasoningScenarios } from "../backend/src/engines/liveReasoningEngine.ts";

const fixtures = JSON.parse(
  readFileSync(new URL("./fixtures/live-reasoning.json", import.meta.url), "utf8"),
) as Array<{ expectedRule: string }>;

/** Edge cases without stable signal bundles — keep at eight or fewer. */
const COACH_SCENARIO_EXEMPT: Record<string, string> = {};

test("every coach scenario id has a fixture or documented exemption", () => {
  const covered = new Set(fixtures.map((entry) => entry.expectedRule));
  const scenarios = listCoachReasoningScenarios();
  const missing: string[] = [];

  for (const scenario of scenarios) {
    if (covered.has(scenario.id)) continue;
    if (COACH_SCENARIO_EXEMPT[scenario.id]) continue;
    missing.push(scenario.id);
  }

  assert.deepEqual(
    missing,
    [],
    `Add live-reasoning.json fixture or COACH_SCENARIO_EXEMPT entry for: ${missing.join(", ")}`,
  );
  assert.ok(Object.keys(COACH_SCENARIO_EXEMPT).length <= 8, "Keep documented exemptions at eight or fewer.");
});

test("live-reasoning fixtures only reference known scenario ids", () => {
  const known = new Set(listCoachReasoningScenarios().map((scenario) => scenario.id));
  const unknown = fixtures.map((entry) => entry.expectedRule).filter((ruleId) => !known.has(ruleId));
  assert.deepEqual(unknown, []);
});
