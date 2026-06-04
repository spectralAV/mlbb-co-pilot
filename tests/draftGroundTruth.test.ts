import assert from "node:assert/strict";
import test from "node:test";
import {
  __resetDraftGroundTruthForTests,
  approveDraft,
  clearDraftGroundTruthSession,
  denyDraft,
  resolveDraftFastPath,
  rosterFingerprint,
  rosterToManualIngest,
} from "../backend/src/services/draftGroundTruth.ts";

test("rosterFingerprint is stable without timestamps", () => {
  const state = {
    phase: "pick",
    allyPicks: [{ heroId: 1, slot: 1 }, null, null, null, null],
    enemyPicks: [null, { heroId: 2, slot: 2 }, null, null, null],
    allyBans: [],
    enemyBans: [],
  };
  const first = rosterFingerprint(state);
  const second = rosterFingerprint({ ...state, frameId: "a", timestamp: 1 });
  assert.equal(first, second);
});

test("approve enables fast path for matching roster", async () => {
  __resetDraftGroundTruthForTests();
  const roster = {
    phase: "pick",
    allyPicks: [16, null, null, null, null],
    enemyPicks: [46, null, null, null, null],
    allyBans: [null, null, null, null, null],
    enemyBans: [null, null, null, null, null],
  };
  await approveDraft(roster);
  const resolved = await resolveDraftFastPath({
    phase: "pick",
    allyPicks: [{ heroId: 16, slot: 1, confidence: 0.6, source: "draft-pick-portrait" }],
    enemyPicks: [{ heroId: 46, slot: 1, confidence: 0.6, source: "draft-pick-portrait" }],
  });
  assert.equal(resolved.action, "fast_path");
  if (resolved.action === "fast_path") {
    const manual = rosterToManualIngest(resolved.state);
    assert.equal(manual.userFeedback, "approved");
  }
});

test("deny blocks repeated wrong CV fingerprint", async () => {
  __resetDraftGroundTruthForTests();
  const wrong = {
    phase: "pick",
    allyPicks: [99, null, null, null, null],
    enemyPicks: [],
    allyBans: [],
    enemyBans: [],
  };
  const corrected = {
    phase: "pick",
    allyPicks: [16, null, null, null, null],
    enemyPicks: [],
    allyBans: [],
    enemyBans: [],
  };
  await denyDraft({ cvFingerprint: rosterFingerprint(wrong), corrected });
  const blocked = await resolveDraftFastPath(wrong);
  assert.equal(blocked.action, "block");
});

test("clearDraftGroundTruthSession drops active approval lock", async () => {
  __resetDraftGroundTruthForTests();
  await approveDraft({
    phase: "pick",
    allyPicks: [8, null, null, null, null],
    enemyPicks: [],
    allyBans: [],
    enemyBans: [],
  });
  clearDraftGroundTruthSession();
  const resolved = await resolveDraftFastPath({
    phase: "pick",
    allyPicks: [8, null, null, null, null],
  });
  assert.equal(resolved.action, "fast_path");
});
