import assert from "node:assert/strict";
import { test } from "node:test";
import { useDraftStore } from "../frontend/src/stores/draftStore.ts";

test("ban slots allow the same hero on ally and enemy", { concurrency: 1 }, () => {
  useDraftStore.getState().clear();
  useDraftStore.getState().placeHero("ban", "ally", 0, 130);
  useDraftStore.getState().placeHero("ban", "enemy", 1, 130);
  const state = useDraftStore.getState();
  assert.equal(state.allyBans[0], 130);
  assert.equal(state.enemyBans[1], 130);
});

test("ban slots move duplicate hero to a new slot on the same side only", { concurrency: 1 }, () => {
  useDraftStore.getState().clear();
  useDraftStore.getState().placeHero("ban", "enemy", 0, 131);
  useDraftStore.getState().placeHero("ban", "enemy", 3, 131);
  const state = useDraftStore.getState();
  assert.equal(state.enemyBans[0], null);
  assert.equal(state.enemyBans[3], 131);
  assert.deepEqual(state.allyBans, [null, null, null, null, null]);
});

test("swapSlots exchanges heroes between two slots on the same side", { concurrency: 1 }, () => {
  useDraftStore.getState().clear();
  useDraftStore.getState().placeHero("pick", "ally", 1, 38);
  useDraftStore.getState().placeHero("pick", "ally", 3, 53);
  useDraftStore.getState().swapSlots("pick", "ally", 1, 3);
  const state = useDraftStore.getState();
  assert.equal(state.allyPicks[1], 53);
  assert.equal(state.allyPicks[3], 38);
});

test("pick slots stay unique across ally and enemy", { concurrency: 1 }, () => {
  useDraftStore.getState().clear();
  useDraftStore.getState().placeHero("pick", "ally", 0, 7);
  useDraftStore.getState().placeHero("pick", "enemy", 1, 7);
  const state = useDraftStore.getState();
  assert.equal(state.allyPicks[0], null);
  assert.equal(state.enemyPicks[1], 7);
});
