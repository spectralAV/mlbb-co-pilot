import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { evaluateLiveReasoning } from "../backend/src/engines/liveReasoningEngine.ts";

const fixtures = JSON.parse(
  readFileSync(new URL("./fixtures/live-reasoning.json", import.meta.url), "utf8"),
) as Array<{ name: string; input: any; expectedRule: string; expectedScene: string }>;

for (const fixture of fixtures) {
  test(`reasoning: ${fixture.name}`, () => {
    const result = evaluateLiveReasoning(fixture.input);
    assert.equal(result.ruleId, fixture.expectedRule);
    assert.equal(result.scene, fixture.expectedScene);
  });
}
