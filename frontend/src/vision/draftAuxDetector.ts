import { getBattleSpellRecognitionManifest, getLaneRecognitionManifest } from "../api/client";
import { acceptIconMatch, rankIconCandidates, spellIconSignatureFromRgba, type HeroIconReference } from "./iconMatcher";
import { optionalCalibratedRect } from "./calibrationRegions";

type NormalizedRect = [number, number, number, number];
type LaneKey = "exp" | "jungle" | "mid" | "roam" | "gold";
type LaneFact = { value: LaneKey; confidence: number; source: "draft-lane-icon" };
type AllyLaneFact = { lane: LaneKey; slot: number; confidence: number; source: "draft-lane-icon" };
type SpellFact = { spell: string; slot: number; confidence: number; source: "draft-battle-spell-icon" };
type NamedReference = HeroIconReference & { value: string };
type LaneReference = { value: LaneKey; label: string; signature: number[] };

const spellSlotBase: NormalizedRect = [0.106, 0.109, 0.026, 0.058];
const rowStep = 0.16645;
const regularLaneRects: NormalizedRect[] = [
  [0.02, 0.1725, 0.03, 0.035],
  [0.015, 0.325, 0.036, 0.045],
  [0.015, 0.485, 0.036, 0.045],
  [0.02, 0.6325, 0.027, 0.055],
  [0.033, 0.143 + rowStep * 4, 0.018, 0.04],
];

let referencesPromise: Promise<{ lanes: LaneReference[]; spells: NamedReference[] }> | null = null;

export function configuredDraftAuxiliarySlots() {
  const laneRail = optionalCalibratedRect("draft_ally_lane_icons_norm");
  const spellRail = optionalCalibratedRect("draft_ally_spell_icons_norm");
  return {
    allyLanes: laneRail ? splitVerticalRail(laneRail) : regularLaneRects,
    allySpells: spellRail ? splitVerticalRail(spellRail) : Array.from({ length: 5 }, (_, slot) => shiftedRow(spellSlotBase, slot)),
  };
}

export async function detectDraftAuxiliaryFacts(canvas: HTMLCanvasElement, selfSlot?: number, diagnostics = false) {
  const references = await getReferences();
  const slots = configuredDraftAuxiliarySlots();
  const allySpells: SpellFact[] = [];
  const allyLanes: AllyLaneFact[] = [];
  const debug: any[] = [];

  for (const [slot, rect] of slots.allySpells.entries()) {
    const crop = cropForRect(canvas, rect);
    if (!crop || !hasVisibleSpellBadge(crop.data)) continue;
    const ranking = rankIconCandidates(spellIconSignatureFromRgba(crop.data, crop.width, crop.height), references.spells);
    const accepted = acceptIconMatch(ranking, 0.70, 0.018);
    debug.push({ fact: "spell", slot: slot + 1, ranking: ranking.slice(0, 3).map((entry) => ({ name: entry.heroName, confidence: entry.confidence })), accepted: accepted?.heroName ?? null });
    const named = accepted && references.spells.find((reference) => reference.heroId === accepted.heroId);
    if (accepted && named) {
      allySpells.push({
        spell: named.value,
        slot: slot + 1,
        confidence: accepted.confidence,
        source: "draft-battle-spell-icon",
      });
    }
  }

  for (const slot of [1, 2, 3, 4, 5]) {
    const candidates = laneSearchRects(slot, slots.allyLanes[slot - 1]).map((rect) => {
      const crop = cropForRect(canvas, rect);
      if (!crop || !hasVisibleLaneGlyph(crop.data)) return { ranking: [], accepted: null };
      const ranking = rankLaneCandidates(laneGlyphSignatureFromRgba(crop.data, crop.width, crop.height), references.lanes);
      return { ranking, accepted: acceptLaneMatch(ranking) };
    });
    const winner = candidates.find((candidate) => candidate.accepted)?.accepted;
    debug.push({ fact: "lane", slot, rankings: candidates.map((candidate) => candidate.ranking.slice(0, 2)), accepted: winner?.value ?? null });
    if (winner) allyLanes.push({ lane: winner.value, slot, confidence: winner.factConfidence, source: "draft-lane-icon" });
  }
  if (selfSlot && !allyLanes.some((fact) => fact.slot === selfSlot)) {
    const crop = cropForRect(canvas, slots.allyLanes[selfSlot - 1]);
    if (crop && hasVisibleLaneGlyph(crop.data)) {
      const accepted = acceptLaneMatch(rankLaneCandidates(laneGlyphSignatureFromRgba(crop.data, crop.width, crop.height), references.lanes));
      if (accepted) allyLanes.push({ lane: accepted.value, slot: selfSlot, confidence: accepted.factConfidence, source: "draft-lane-icon" });
    }
  }
  const ownLane = allyLanes.find((fact) => fact.slot === selfSlot);
  const selectedLane: LaneFact | undefined = ownLane
    ? { value: ownLane.lane, confidence: ownLane.confidence, source: "draft-lane-icon" }
    : undefined;
  if (diagnostics) console.info("[draft-aux-cv-diagnostics]", JSON.stringify(debug));

  return {
    ...(selectedLane ? { selectedLane } : {}),
    allyLanes,
    allySpells,
  };
}

export function hasVisibleLaneGlyph(rgba: Uint8ClampedArray) {
  let brightNeutral = 0;
  let sampled = 0;
  for (let index = 0; index < rgba.length; index += 12) {
    const red = rgba[index];
    const green = rgba[index + 1];
    const blue = rgba[index + 2];
    const luma = red * 0.299 + green * 0.587 + blue * 0.114;
    const spread = Math.max(red, green, blue) - Math.min(red, green, blue);
    if (luma > 135 && spread < 88) brightNeutral += 1;
    sampled += 1;
  }
  return sampled > 0 && brightNeutral / sampled > 0.035;
}

export function hasVisibleSpellBadge(rgba: Uint8ClampedArray) {
  let coloredBright = 0;
  let sampled = 0;
  for (let index = 0; index < rgba.length; index += 12) {
    const red = rgba[index];
    const green = rgba[index + 1];
    const blue = rgba[index + 2];
    const luma = red * 0.299 + green * 0.587 + blue * 0.114;
    const spread = Math.max(red, green, blue) - Math.min(red, green, blue);
    if (luma > 70 && spread > 28) coloredBright += 1;
    sampled += 1;
  }
  return sampled > 0 && coloredBright / sampled > 0.08;
}

function shiftedRow(rect: NormalizedRect, index: number): NormalizedRect {
  return [rect[0], rect[1] + rowStep * index, rect[2], rect[3]];
}

function splitVerticalRail(rect: NormalizedRect) {
  return Array.from({ length: 5 }, (_, index) => [rect[0], rect[1] + rect[3] * index / 5, rect[2], rect[3] / 5] as NormalizedRect);
}

function laneSearchRects(slot: number, primary: NormalizedRect) {
  const index = slot - 1;
  if (optionalCalibratedRect("draft_ally_lane_icons_norm")) {
    return [primary, expandRect(primary, 1.35)];
  }
  const expanded = [0.052, 0.09 + rowStep * index, 0.045, 0.1] as NormalizedRect;
  return [primary, expanded];
}

function expandRect(rect: NormalizedRect, factor: number): NormalizedRect {
  const width = Math.min(1, rect[2] * factor);
  const height = Math.min(1, rect[3] * factor);
  return [
    Math.max(0, Math.min(1 - width, rect[0] - (width - rect[2]) / 2)),
    Math.max(0, Math.min(1 - height, rect[1] - (height - rect[3]) / 2)),
    width,
    height,
  ];
}

function cropForRect(canvas: HTMLCanvasElement, rect: NormalizedRect) {
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return null;
  return context.getImageData(
    Math.round(rect[0] * canvas.width),
    Math.round(rect[1] * canvas.height),
    Math.max(1, Math.round(rect[2] * canvas.width)),
    Math.max(1, Math.round(rect[3] * canvas.height)),
  );
}

async function getReferences() {
  if (!referencesPromise) referencesPromise = loadReferences();
  return referencesPromise;
}

async function loadReferences() {
  const [laneResult, spellResult] = await Promise.all([
    getLaneRecognitionManifest(),
    getBattleSpellRecognitionManifest(),
  ]);
  const lanes: LaneReference[] = [];
  const spells: NamedReference[] = [];

  for (const lane of laneResult?.data?.lanes ?? []) {
    const image = await loadImage(`/api/vision/lanes/icon/${lane.id}`);
    if (image) lanes.push(createLaneReference(String(lane.name), String(lane.key) as LaneKey, image));
  }
  for (const [index, spell] of (spellResult?.data?.spells ?? []).entries()) {
    const image = await loadImage(`/api/vision/spells/icon/${spell.id}`);
    if (image) spells.push(createReference(index + 1, String(spell.name), String(spell.name), image));
  }
  return { lanes, spells };
}

function createLaneReference(label: string, value: LaneKey, image: HTMLImageElement): LaneReference {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  const context = canvas.getContext("2d", { willReadFrequently: true })!;
  context.fillStyle = "#112d4e";
  context.fillRect(0, 0, 64, 64);
  context.drawImage(image, 0, 0, 64, 64);
  return {
    label,
    value,
    signature: laneGlyphSignatureFromRgba(context.getImageData(0, 0, 64, 64).data, 64, 64),
  };
}

function laneGlyphSignatureFromRgba(rgba: Uint8ClampedArray, width: number, height: number, gridSize = 20) {
  const isGlyph = (x: number, y: number) => {
    const index = (y * width + x) * 4;
    const red = rgba[index];
    const green = rgba[index + 1];
    const blue = rgba[index + 2];
    const luma = red * 0.299 + green * 0.587 + blue * 0.114;
    return luma > 115 && Math.max(red, green, blue) - Math.min(red, green, blue) < 105;
  };
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (!isGlyph(x, y)) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  if (maxX < 0) return [];
  const pad = Math.max(1, Math.round(Math.max(maxX - minX, maxY - minY) * 0.05));
  minX = Math.max(0, minX - pad);
  minY = Math.max(0, minY - pad);
  maxX = Math.min(width - 1, maxX + pad);
  maxY = Math.min(height - 1, maxY + pad);
  const signature: number[] = [];
  for (let gy = 0; gy < gridSize; gy += 1) {
    for (let gx = 0; gx < gridSize; gx += 1) {
      let bright = 0;
      let total = 0;
      for (let y = Math.floor(minY + gy * (maxY - minY + 1) / gridSize); y < Math.floor(minY + (gy + 1) * (maxY - minY + 1) / gridSize); y += 1) {
        for (let x = Math.floor(minX + gx * (maxX - minX + 1) / gridSize); x < Math.floor(minX + (gx + 1) * (maxX - minX + 1) / gridSize); x += 1) {
          if (isGlyph(x, y)) bright += 1;
          total += 1;
        }
      }
      signature.push(total ? bright / total : 0);
    }
  }
  return signature;
}

function rankLaneCandidates(signature: number[], references: LaneReference[]) {
  return references.map((reference) => {
    let squaredError = 0;
    for (let index = 0; index < signature.length; index += 1) squaredError += (signature[index] - reference.signature[index]) ** 2;
    return {
      value: reference.value,
      label: reference.label,
      confidence: Math.max(0, 1 - Math.sqrt(squaredError / signature.length)),
    };
  }).sort((left, right) => right.confidence - left.confidence);
}

function acceptLaneMatch(ranking: Array<{ value: LaneKey; label: string; confidence: number }>) {
  const best = ranking[0];
  const second = ranking.find((candidate) => candidate.value !== best?.value);
  const margin = best && second ? best.confidence - second.confidence : 0;
  if (!best || best.confidence < 0.5) return null;
  if (second && margin < 0.075) return null;
  return {
    ...best,
    factConfidence: Math.min(0.98, Math.max(best.confidence, 0.56 + margin * 1.5)),
  };
}

function createReference(id: number, label: string, value: string, image: HTMLImageElement, background?: string): NamedReference {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  const context = canvas.getContext("2d", { willReadFrequently: true })!;
  if (background) {
    context.fillStyle = background;
    context.fillRect(0, 0, 64, 64);
  }
  context.drawImage(image, 0, 0, 64, 64);
  return {
    heroId: id,
    heroName: label,
    value,
    variant: "normal",
    signature: spellIconSignatureFromRgba(context.getImageData(0, 0, 64, 64).data, 64, 64),
  };
}

function loadImage(url: string) {
  return new Promise<HTMLImageElement | null>((resolve) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = url;
  });
}
