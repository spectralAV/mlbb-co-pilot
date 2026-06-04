import assert from "node:assert/strict";
import { test } from "node:test";
import { getMatchState, resetMatchState } from "../backend/src/state/matchState.ts";
import { __resetDraftGroundTruthForTests } from "../backend/src/services/draftGroundTruth.ts";
import { getLatestDraftRecognition, ingestDraftRecognition, resetDraftRecognition } from "../backend/src/vision/draftRecognition.ts";
import { ingestLiveVisionFrame } from "../backend/src/vision/liveVisionState.ts";

test("draft recognition resets when vision returns to lobby after a match screen", async () => {
  resetMatchState();
  resetDraftRecognition();
  await ingestDraftRecognition({
    phase: "pick",
    allyPicks: [{ heroId: 14, heroName: "Eudora", confidence: 0.9, source: "draft-pick-portrait", slot: 1 }],
    enemyPicks: [{ heroId: 15, heroName: "Franco", confidence: 0.9, source: "draft-pick-portrait", slot: 1 }],
  });
  assert.ok(getLatestDraftRecognition());
  assert.ok(getMatchState().draft?.allyPicks.length);

  ingestLiveVisionFrame({ screen: "live_hud", confidence: 0.9, timestamp: Date.now() });
  ingestLiveVisionFrame({ screen: "lobby", confidence: 0.9, timestamp: Date.now() });

  assert.equal(getLatestDraftRecognition(), null);
  assert.equal(getMatchState().draft, null);
});

test("entering draft from scoreboard clears prior match draft state", async () => {
  resetMatchState();
  resetDraftRecognition();
  await ingestDraftRecognition({
    phase: "pick",
    allyPicks: [{ heroId: 14, heroName: "Eudora", confidence: 0.9, source: "draft-pick-portrait", slot: 1 }],
  });
  assert.ok(getMatchState().draft?.allyPicks.length);
  ingestLiveVisionFrame({ screen: "scoreboard", confidence: 0.9, timestamp: Date.now() });
  ingestLiveVisionFrame({ screen: "draft", confidence: 0.9, timestamp: Date.now() });
  assert.equal(getLatestDraftRecognition(), null);
  assert.equal(getMatchState().draft, null);
});

test("resetDraftRecognition clears cached draft payload", async () => {
  resetMatchState();
  await ingestDraftRecognition({
    phase: "pick",
    allyPicks: [{ heroId: 7, heroName: "Alucard", confidence: 0.92, source: "draft-pick-portrait", slot: 2 }],
  });
  assert.ok(getLatestDraftRecognition());
  resetDraftRecognition();
  assert.equal(getLatestDraftRecognition(), null);
});

test("manual corrected draft ingest is trusted over provisional CV", async () => {
  __resetDraftGroundTruthForTests();
  resetMatchState();
  resetDraftRecognition();
  await ingestDraftRecognition({
    phase: "pick",
    allyPicks: [{ heroId: 99, heroName: "Wrong", confidence: 0.95, source: "draft-pick-portrait", slot: 1 }],
    provisional: true,
  });
  await ingestDraftRecognition({
    phase: "pick",
    userFeedback: "corrected",
    allyPicks: [{ heroId: 16, slot: 1, confidence: 1, source: "manual" }],
    enemyPicks: [],
    allyBans: [],
    enemyBans: [],
  });
  const latest = getLatestDraftRecognition();
  assert.equal(latest?.state?.allyPicks?.[0]?.heroId, 16);
  assert.equal(latest?.state?.groundTruthTrusted, true);
});
