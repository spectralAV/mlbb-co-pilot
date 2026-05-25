import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { acceptPortraitMatch, mirrorPortraitSignature, rankPortraitCandidates } from "../frontend/src/vision/portraitMatcher.ts";

const fixtures = JSON.parse(
  readFileSync(new URL("./fixtures/portrait-matches.json", import.meta.url), "utf8"),
) as Array<{ name: string; observed: number[]; references: any[]; expectedHeroId: number | null }>;

for (const fixture of fixtures) {
  test(`portrait matcher: ${fixture.name}`, () => {
    const accepted = acceptPortraitMatch(rankPortraitCandidates(fixture.observed, fixture.references));
    assert.equal(accepted?.heroId ?? null, fixture.expectedHeroId);
  });
}

test("portrait matcher mirrors signature columns", () => {
  assert.deepEqual(
    mirrorPortraitSignature([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], 2),
    [4, 5, 6, 1, 2, 3, 10, 11, 12, 7, 8, 9],
  );
});
