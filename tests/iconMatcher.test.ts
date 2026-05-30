import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { configuredDraftBanIconSlots, configuredDraftPickPortraitSlots, hasVisibleDraftBanIcon, hasVisibleDraftPortrait, pickReferenceModelForVisibleSlots, strongestAcceptedMatch } from "../frontend/src/vision/draftIconDetector.ts";
import { configuredDraftContextRegions, detectDraftVisualContextFromRgba } from "../frontend/src/vision/draftContextDetector.ts";
import { configuredDraftAuxiliarySlots, hasVisibleLaneGlyph, hasVisibleSpellBadge } from "../frontend/src/vision/draftAuxDetector.ts";
import { configuredEquipmentSlots } from "../frontend/src/vision/equipmentDetector.ts";
import { resetActiveCalibrationRegions, setActiveCalibrationRegions } from "../frontend/src/vision/calibrationRegions.ts";
import { acceptIconMatch, mirrorIconSignature, rankIconCandidates } from "../frontend/src/vision/iconMatcher.ts";
import { acceptPortraitMatch, mirrorDraftBannerSignature, mirrorPortraitSignature, rankDraftBannerCandidates, rankPortraitCandidates } from "../frontend/src/vision/portraitMatcher.ts";

const sharp = createRequire(new URL("../backend/package.json", import.meta.url))("sharp");
const fixtures = JSON.parse(
  readFileSync(new URL("./fixtures/icon-matches.json", import.meta.url), "utf8"),
) as Array<{ name: string; observed: number[]; references: any[]; expectedHeroId: number | null }>;

for (const fixture of fixtures) {
  test(`icon matcher: ${fixture.name}`, () => {
    const accepted = acceptIconMatch(rankIconCandidates(fixture.observed, fixture.references));
    assert.equal(accepted?.heroId ?? null, fixture.expectedHeroId);
  });
}

test("icon matcher mirrors signature columns", () => {
  assert.deepEqual(
    mirrorIconSignature([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], 2),
    [4, 5, 6, 1, 2, 3, 10, 11, 12, 7, 8, 9],
  );
});

test("draft icon detector exposes ban rails only", () => {
  const slots = configuredDraftBanIconSlots();
  assert.deepEqual(Object.keys(slots).sort(), ["allyBans", "enemyBans"]);
  assert.equal(slots.allyBans.length, 5);
  assert.equal(slots.enemyBans.length, 5);
});

test("draft portrait detector exposes both confirmed pick rails", () => {
  const slots = configuredDraftPickPortraitSlots();
  assert.deepEqual(Object.keys(slots).sort(), ["allyPicks", "enemyPicks"]);
  assert.equal(slots.allyPicks.length, 5);
  assert.equal(slots.enemyPicks.length, 5);
});

test("draft pick reference model uses base heroes until the tenth pick is confirmed", () => {
  assert.equal(pickReferenceModelForVisibleSlots([true, true, true, true, true, true, true, true, true, false]), "base-icon");
  assert.equal(pickReferenceModelForVisibleSlots(Array.from({ length: 10 }, () => true)), "skin-icon");
});

test("draft pick surface arbitration keeps the strongest accepted identity", () => {
  const match = strongestAcceptedMatch(
    { heroId: 46, heroName: "Odette", variant: "mirror-x", confidence: 0.997 },
    { heroId: 27, heroName: "Sun", variant: "mirror-x", confidence: 0.827 },
  );
  assert.equal(match?.heroName, "Odette");
  assert.equal(match?.confidence, 0.997);
});

test("draft auxiliary detector exposes aligned lane and battle-spell rows", () => {
  const slots = configuredDraftAuxiliarySlots();
  assert.equal(slots.allyLanes.length, 5);
  assert.equal(slots.allySpells.length, 5);
  assert.deepEqual(slots.allyLanes[2], [0.015, 0.485, 0.036, 0.045]);
  assert.deepEqual(slots.allySpells[0], [0.106, 0.109, 0.026, 0.058]);
  assert.equal(slots.allyLanes[2][1] > slots.allyLanes[1][1], true);
});

test("active calibration preset drives draft rails, context, auxiliary slots, and equipment geometry", () => {
  setActiveCalibrationRegions({
    ally_bans_norm: [[0.1, 0.02, 0.25, 0.1]],
    ally_picks_norm: [[0.03, 0.15, 0.18, 0.7]],
    draft_self_highlight_rail_norm: [0.03, 0.15, 0.18, 0.7],
    draft_first_pick_ally_indicator_norm: [0.25, 0.03, 0.06, 0.08],
    draft_ally_lane_icons_norm: [0.01, 0.2, 0.03, 0.5],
    draft_ally_spell_icons_norm: [0.11, 0.2, 0.03, 0.5],
    equipment_window_norm: [0.2, 0.2, 0.6, 0.6],
  }, "test preset");
  try {
    const bans = configuredDraftBanIconSlots();
    const picks = configuredDraftPickPortraitSlots();
    const context = configuredDraftContextRegions();
    const auxiliary = configuredDraftAuxiliarySlots();
    const equipment = configuredEquipmentSlots("ally");
    assert.deepEqual(bans.allyBans[0], [0.1, 0.02, 0.05, 0.1]);
    assert.deepEqual(picks.allyPicks[0].map((value) => Number(value.toFixed(3))), [0.03, 0.15, 0.18, 0.14]);
    assert.deepEqual(context.selfRail, [0.03, 0.15, 0.18, 0.7]);
    assert.deepEqual(context.firstPickMarkers.ally, [0.25, 0.03, 0.06, 0.08]);
    assert.deepEqual(auxiliary.allyLanes[2], [0.01, 0.4, 0.03, 0.1]);
    assert.deepEqual(auxiliary.allySpells[4].map((value) => Number(value.toFixed(3))), [0.11, 0.6, 0.03, 0.1]);
    assert.notDeepEqual(equipment[0].rect, [0.294, 0.32275, 0.028, 0.0625]);
  } finally {
    resetActiveCalibrationRegions();
  }
});

test("draft auxiliary detector rejects blank spell badges", () => {
  const empty = new Uint8ClampedArray(50 * 50 * 4);
  const visible = new Uint8ClampedArray(50 * 50 * 4);
  paint(visible, 50, 50, [0.1, 0.1, 0.8, 0.8], [208, 148, 37]);
  assert.equal(hasVisibleSpellBadge(empty), false);
  assert.equal(hasVisibleSpellBadge(visible), true);
});

test("draft auxiliary detector requires a bright lane glyph", () => {
  const dark = new Uint8ClampedArray(50 * 50 * 4);
  const glyph = new Uint8ClampedArray(50 * 50 * 4);
  paint(glyph, 50, 50, [0.2, 0.2, 0.6, 0.25], [212, 226, 239]);
  assert.equal(hasVisibleLaneGlyph(dark), false);
  assert.equal(hasVisibleLaneGlyph(glyph), true);
});

test("draft icon detector rejects empty dark ban placeholders before matching", () => {
  const empty = new Uint8ClampedArray(100 * 100 * 4);
  const filled = new Uint8ClampedArray(100 * 100 * 4);
  paint(filled, 100, 100, [0, 0, 1, 0.28], [180, 170, 145]);
  paint(filled, 100, 100, [0, 0.28, 1, 0.6], [24, 42, 62]);
  assert.equal(hasVisibleDraftBanIcon(empty), false);
  assert.equal(hasVisibleDraftBanIcon(filled), true);
});

test("portrait matcher accepts distinct official art and rejects empty pick slots", () => {
  const reference = { heroId: 8, heroName: "Portrait", variant: "normal" as const, signature: [0.2, 0.4, 0.7, 0.8, 0.1, 0.3] };
  assert.equal(acceptPortraitMatch(rankPortraitCandidates(reference.signature, [
    reference,
    { heroId: 9, heroName: "Other", variant: "normal", signature: [0.9, 0.8, 0.1, 0.1, 0.4, 0.7] },
  ]))?.heroId, 8);
  assert.deepEqual(mirrorPortraitSignature([1, 2, 3, 4, 5, 6], 2, 1), [4, 5, 6, 1, 2, 3]);
  assert.equal(hasVisibleDraftPortrait(new Uint8ClampedArray(50 * 50 * 4)), false);
});

test("draft banner matcher accepts a horizontally mirrored portrait presentation", () => {
  const normal = [-1, -1, 1, 1, -1, 1, -1, 1];
  const mirrored = mirrorDraftBannerSignature(normal, 4, 2);
  const accepted = acceptPortraitMatch(rankDraftBannerCandidates(mirrored, [
    { heroId: 46, heroName: "Odette", variant: "normal", signature: normal },
    { heroId: 46, heroName: "Odette", variant: "mirror-x", signature: mirrored },
    { heroId: 60, heroName: "Other", variant: "normal", signature: [-0.1, -0.2, -0.3, -0.4, 0.1, 0.2, 0.3, 0.4] },
  ]), 0.8, 0.05);
  assert.equal(accepted?.heroName, "Odette");
  assert.equal(accepted?.variant, "mirror-x");
});

test("draft context detector identifies yellow self slot and ally first pick", () => {
  const width = 1000;
  const height = 500;
  const rgba = new Uint8ClampedArray(width * height * 4);
  paint(rgba, width, height, [0.01, 0.1 + 0.88 * 3 / 5, 0.16, 0.88 / 5], [224, 177, 30]);
  paint(rgba, width, height, [0.278, 0.032, 0.052, 0.072], [35, 130, 242]);
  const context = detectDraftVisualContextFromRgba(rgba, width, height);
  assert.equal(context.selfSlot?.value, 4);
  assert.equal(context.firstPickSide?.value, "ally");
});

test("draft context detector identifies enemy first pick", () => {
  const width = 1000;
  const height = 500;
  const rgba = new Uint8ClampedArray(width * height * 4);
  paint(rgba, width, height, [0.702, 0.032, 0.052, 0.072], [232, 58, 72]);
  const context = detectDraftVisualContextFromRgba(rgba, width, height);
  assert.equal(context.firstPickSide?.value, "enemy");
});

test("draft context detector reads first-pick sides from recorded ranked frames", async (t) => {
  const cases = [
    { file: "../samples/video-analysis/legend/keyframes/draft-ban-grid.png", expected: "ally" },
    { file: "../samples/video-analysis/mythic/keyframes/draft-ban-grid.png", expected: "enemy" },
  ].map((sample) => ({
    ...sample,
    path: fileURLToPath(new URL(sample.file, import.meta.url)),
  }));
  const missing = cases.filter((sample) => !existsSync(sample.path));
  if (missing.length > 0) {
    t.skip(`Optional recorded frame fixture missing: ${missing.map((sample) => sample.file).join(", ")}`);
    return;
  }
  for (const sample of cases) {
    const { data, info } = await sharp(sample.path).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const context = detectDraftVisualContextFromRgba(new Uint8ClampedArray(data), info.width, info.height);
    assert.equal(context.firstPickSide?.value, sample.expected);
    assert.ok(Number(context.firstPickSide?.confidence ?? 0) >= 0.8);
  }
});

test("draft context detector isolates the yellow username band from lower-row color noise", () => {
  const width = 1000;
  const height = 1000;
  const rgba = new Uint8ClampedArray(width * height * 4);
  paint(rgba, width, height, [0.045, 0.545, 0.085, 0.03], [224, 177, 30]);
  paint(rgba, width, height, [0.045, 0.76, 0.085, 0.03], [224, 177, 30]);
  const context = detectDraftVisualContextFromRgba(rgba, width, height);
  assert.equal(context.selfSlot?.value, 3);
});

function paint(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  rect: [number, number, number, number],
  color: [number, number, number],
) {
  for (let y = Math.floor(rect[1] * height); y < Math.ceil((rect[1] + rect[3]) * height); y += 1) {
    for (let x = Math.floor(rect[0] * width); x < Math.ceil((rect[0] + rect[2]) * width); x += 1) {
      const index = (y * width + x) * 4;
      rgba[index] = color[0];
      rgba[index + 1] = color[1];
      rgba[index + 2] = color[2];
      rgba[index + 3] = 255;
    }
  }
}
