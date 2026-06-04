import type { DraftState } from "../state/matchState.js";

function slotHeroName(slots: Array<{ slot?: number; heroName?: string }>, slot: number) {
  return slots.find((entry) => entry.slot === slot)?.heroName;
}

export function evaluateDraftScenarioExpect(
  expect: Record<string, unknown>,
  draft: DraftState | null | undefined,
): { ok: boolean; failures: string[] } {
  const failures: string[] = [];
  if (!draft) {
    failures.push("no draft state");
    return { ok: false, failures };
  }

  if (Array.isArray(expect.allyBanSlots)) {
    const expected = [...(expect.allyBanSlots as number[])].sort((a, b) => a - b);
    const actual = draft.allyBans.map((entry) => entry.slot).sort((a, b) => a - b);
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      failures.push(`allyBanSlots: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    }
  }
  if (Array.isArray(expect.allyBanHeroNames)) {
    const expected = [...(expect.allyBanHeroNames as string[])].sort();
    const actual = draft.allyBans.map((entry) => entry.heroName).sort();
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      failures.push(`allyBanHeroNames: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    }
  }
  if (Array.isArray(expect.enemyBanHeroNames)) {
    const expected = [...(expect.enemyBanHeroNames as string[])].sort();
    const actual = draft.enemyBans.map((entry) => entry.heroName).sort();
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      failures.push(`enemyBanHeroNames: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    }
  }

  const allyPickBySlot = expect.allyPickBySlot as Record<string, string> | undefined;
  if (allyPickBySlot) {
    for (const [slot, heroName] of Object.entries(allyPickBySlot)) {
      const actual = slotHeroName(draft.allyPicks, Number(slot));
      if (actual !== heroName) failures.push(`ally pick slot ${slot}: expected ${heroName}, got ${actual ?? "(empty)"}`);
    }
  }

  if (typeof expect.selectedLane === "string" && draft.selectedLane?.value !== expect.selectedLane) {
    failures.push(`selectedLane: expected ${expect.selectedLane}, got ${draft.selectedLane?.value ?? "(none)"}`);
  }

  const allyLaneBySlot = expect.allyLaneBySlot as Record<string, string> | undefined;
  if (allyLaneBySlot) {
    for (const [slot, lane] of Object.entries(allyLaneBySlot)) {
      const entry = draft.allyLanes?.find((row) => row.slot === Number(slot));
      if (entry?.lane !== lane) failures.push(`ally lane slot ${slot}: expected ${lane}, got ${entry?.lane ?? "(none)"}`);
    }
  }

  return { ok: failures.length === 0, failures };
}
