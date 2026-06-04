import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { getMatchState, resetMatchState } from "../backend/src/state/matchState.ts";
import { resetDraftSlotStabilizer } from "../backend/src/state/draftStabilizer.ts";
import { ingestDraftRecognition, resetDraftRecognition } from "../backend/src/vision/draftRecognition.ts";

type ScenarioFile = {
  scenarios: Array<{
    id: string;
    frames: Array<Record<string, unknown>>;
    expect: Record<string, unknown>;
  }>;
};

const scenarios = JSON.parse(
  readFileSync(new URL("../data/recognition-samples/draft-lifecycle-scenarios.json", import.meta.url), "utf8"),
) as ScenarioFile;

function slotHeroName(slots: Array<{ slot?: number; heroName?: string }>, slot: number) {
  return slots.find((entry) => entry.slot === slot)?.heroName;
}

async function replayScenario(scenario: ScenarioFile["scenarios"][number]) {
  resetMatchState();
  resetDraftRecognition();
  resetDraftSlotStabilizer();
  for (const frame of scenario.frames) {
    await ingestDraftRecognition({
      phase: String(frame.phase ?? "pick"),
      timestamp: Date.now(),
      frameId: `scenario:${scenario.id}`,
      ...frame,
    });
  }
  return getMatchState().draft;
}

for (const scenario of scenarios.scenarios) {
  test(`draft lifecycle scenario: ${scenario.id}`, async () => {
    const draft = await replayScenario(scenario);
    assert.ok(draft, `expected draft state for ${scenario.id}`);

    if (Array.isArray(scenario.expect.allyBanSlots)) {
      assert.deepEqual(draft.allyBans.map((entry) => entry.slot).sort(), scenario.expect.allyBanSlots);
    }
    if (Array.isArray(scenario.expect.allyBanHeroNames)) {
      assert.deepEqual(
        draft.allyBans.map((entry) => entry.heroName).sort(),
        [...scenario.expect.allyBanHeroNames].sort(),
      );
    }
    if (Array.isArray(scenario.expect.enemyBanHeroNames)) {
      assert.deepEqual(
        draft.enemyBans.map((entry) => entry.heroName).sort(),
        [...scenario.expect.enemyBanHeroNames].sort(),
      );
    }

    const allyPickBySlot = scenario.expect.allyPickBySlot as Record<string, string> | undefined;
    if (allyPickBySlot) {
      assert.ok(
        draft.allyPicks.length > 0,
        `expected ally picks for ${scenario.id}, got ${JSON.stringify(draft.allyPicks)}`,
      );
      for (const [slot, heroName] of Object.entries(allyPickBySlot)) {
        assert.equal(
          slotHeroName(draft.allyPicks, Number(slot)),
          heroName,
          `slot ${slot} roster=${JSON.stringify(draft.allyPicks)}`,
        );
      }
    }

    if (typeof scenario.expect.selectedLane === "string") {
      assert.equal(draft.selectedLane?.value, scenario.expect.selectedLane);
    }

    const allyLaneBySlot = scenario.expect.allyLaneBySlot as Record<string, string> | undefined;
    if (allyLaneBySlot) {
      for (const [slot, lane] of Object.entries(allyLaneBySlot)) {
        assert.equal(draft.allyLanes.find((entry) => entry.slot === Number(slot))?.lane, lane);
      }
    }
  });
}
