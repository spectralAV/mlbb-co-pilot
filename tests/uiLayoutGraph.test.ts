import assert from "node:assert/strict";
import { test } from "node:test";
import { getUiLayoutGraphSummary, readUiLayoutGraphBundle } from "../backend/src/services/uiLayoutGraph.ts";

test("ui layout graph summary reports ready when graph file exists", async () => {
  const summary = await getUiLayoutGraphSummary();
  if (!summary.ready) {
    assert.equal(summary.bundlesScanned, 0);
    return;
  }
  assert.ok(summary.bundlesScanned > 0);
  assert.ok(summary.totalNodes > 0);
  assert.ok(summary.bytes > 0);
});

test("ui layout graph can load ChooseHeroBP bundle entry", async () => {
  const entry = await readUiLayoutGraphBundle("UI_ChooseHeroBP.unity3d");
  if (!entry) return;
  assert.equal(entry.bundle, "UI_ChooseHeroBP.unity3d");
  const heroes = (entry.nodes as Array<{ name: string; normalizedRect?: number[] | null }>).filter((node) => /^Hero\d+$/i.test(node.name));
  assert.ok(heroes.length > 0);
  assert.ok(heroes.some((hero) => Array.isArray(hero.normalizedRect) && hero.normalizedRect.length === 4));
});
