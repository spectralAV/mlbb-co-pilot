import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { getMatchState, resetMatchState } from "../backend/src/state/matchState.ts";
import { resetDraftSlotStabilizer } from "../backend/src/state/draftStabilizer.ts";
import { evaluateDraftScenarioExpect } from "../backend/src/vision/draftScenarioExpect.ts";
import { ingestDraftRecognition, resetDraftRecognition } from "../backend/src/vision/draftRecognition.ts";

const scenariosFile = JSON.parse(
  readFileSync(new URL("../data/recognition-samples/draft-lifecycle-scenarios.json", import.meta.url), "utf8"),
) as {
  scenarios: Array<{
    id: string;
    description?: string;
    frames: Array<Record<string, unknown>>;
    expect?: Record<string, unknown>;
  }>;
};

async function replayScenario(scenario: (typeof scenariosFile.scenarios)[number]) {
  resetMatchState();
  resetDraftRecognition();
  resetDraftSlotStabilizer();
  for (const [index, frame] of scenario.frames.entries()) {
    const rawPhase = String(frame.phase ?? "pick");
    const phase =
      rawPhase === "ban" || rawPhase === "pick" || rawPhase === "finalize" || rawPhase === "loading"
        ? rawPhase
        : "pick";
    await ingestDraftRecognition({
      timestamp: Date.now(),
      frameId: `simulator:${scenario.id}:${index + 1}`,
      ...frame,
      phase,
    });
  }
  return getMatchState().draft;
}

test("draft lifecycle scenarios match simulator replay contract", async () => {
  assert.ok(scenariosFile.scenarios.length >= 7);
  for (const scenario of scenariosFile.scenarios) {
    const draft = await replayScenario(scenario);
    const evaluation = evaluateDraftScenarioExpect(scenario.expect ?? {}, draft);
    assert.equal(
      evaluation.ok,
      true,
      `${scenario.id}: ${evaluation.failures.join("; ")}`,
    );
  }
});

test("scenario ids are unique", () => {
  const ids = scenariosFile.scenarios.map((entry) => entry.id);
  assert.equal(new Set(ids).size, ids.length);
});
