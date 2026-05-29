import { readFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { cache } from "../services/cacheService.js";
import { readMlbbAdbHeroHead, readMlbbAdbSkinHeadReferences } from "../services/mlbbAdbAssets.js";
import { getHeroRecognitionManifest } from "./heroRecognition.js";

const modelFile = "cv-draft-hero-model.json";
const projectRoot = path.resolve(process.cwd(), "..");
const replayValidationFile = path.join(projectRoot, "data", "recognition-samples", "draft-skin-validation-set.json");
const finalPickMinimumConfidence = 0.85;
const finalPickMinimumMargin = 0.045;

type Reference = {
  heroId: number;
  heroName: string;
  variant: "normal" | "mirror-x";
  signature: number[];
  skinId?: string;
  source?: "official-hero-head" | "official-skin-head";
};
type SurfaceReferences = {
  banIcons: Reference[];
  basePickIcons: Reference[];
  overlayPickIcons: Reference[];
  skinPickIcons: Reference[];
};
export type DraftHeroModel = {
  version: string;
  trainedAt: string;
  source: string;
  heroCount: number;
  officialSkinHeads: {
    imageCount: number;
    heroCount: number;
  };
  references: SurfaceReferences;
  validation: {
    examples: number;
    correct: number;
    accuracy: number;
    description: string;
  };
  skinValidation: {
    examples: number;
    correct: number;
    accuracy: number;
    description: string;
  };
  replayValidation: {
    examples: number;
    correct: number;
    accepted: number;
    accuracy: number;
    description: string;
    predictions: Array<{
      id: string;
      expectedHeroName: string;
      predictedHeroName: string | null;
      accepted: boolean;
      correct: boolean;
      confidence: number;
      margin: number;
      cropIndex: number | null;
      skinId: string | null;
    }>;
  };
};

export async function getDraftHeroModel() {
  return cache.read<DraftHeroModel | null>(modelFile, null);
}

export async function getDraftHeroModelStatus() {
  const model = await getDraftHeroModel();
  return { available: Boolean(model), model };
}

export async function trainDraftHeroModel() {
  const manifest = await getHeroRecognitionManifest();
  const heroNames = new Map(manifest.heroes.map((hero) => [hero.id, hero.name]));
  const references: SurfaceReferences = { banIcons: [], basePickIcons: [], overlayPickIcons: [], skinPickIcons: [] };
  const heldOut: Array<{ heroId: number; heroName: string; signature: number[] }> = [];
  for (const hero of manifest.heroes) {
    const image = await readMlbbAdbHeroHead(hero.id);
    if (!image) continue;
    const normal = await rawIcon(image);
    const altered = await rawIcon(await sharp(image).modulate({ brightness: 0.91, saturation: 0.94 }).jpeg({ quality: 78 }).toBuffer());
    const banSignature = maskedSignature(normal.data, normal.width, normal.height, 16, "ban");
    const baseSignature = maskedSignature(normal.data, normal.width, normal.height, 8, "ban");
    const overlaySignature = maskedSignature(normal.data, normal.width, normal.height, 8, "pick");
    references.banIcons.push(
      reference(hero.id, hero.name, "normal", banSignature, undefined, "official-hero-head"),
      reference(hero.id, hero.name, "mirror-x", mirrorSignature(banSignature, 16), undefined, "official-hero-head"),
    );
    references.basePickIcons.push(
      reference(hero.id, hero.name, "normal", baseSignature, undefined, "official-hero-head"),
      reference(hero.id, hero.name, "mirror-x", mirrorSignature(baseSignature, 8), undefined, "official-hero-head"),
    );
    references.overlayPickIcons.push(
      reference(hero.id, hero.name, "normal", overlaySignature, undefined, "official-hero-head"),
      reference(hero.id, hero.name, "mirror-x", mirrorSignature(overlaySignature, 8), undefined, "official-hero-head"),
    );
    heldOut.push({
      heroId: hero.id,
      heroName: hero.name,
      signature: maskedSignature(altered.data, altered.width, altered.height, 16, "ban"),
    });
  }
  const officialSkinHeads = await readMlbbAdbSkinHeadReferences();
  const heldOutSkins: Array<{ heroId: number; signature: number[] }> = [];
  for (const skin of officialSkinHeads) {
    const heroName = heroNames.get(skin.heroId);
    if (!heroName) continue;
    const normal = await rawIcon(skin.image);
    const altered = await rawIcon(await sharp(skin.image).modulate({ brightness: 0.91, saturation: 0.94 }).jpeg({ quality: 78 }).toBuffer());
    const signature = maskedSignature(normal.data, normal.width, normal.height, 8, "ban");
    references.skinPickIcons.push(
      reference(skin.heroId, heroName, "normal", signature, skin.skinId, "official-skin-head"),
      reference(skin.heroId, heroName, "mirror-x", mirrorSignature(signature, 8), skin.skinId, "official-skin-head"),
    );
    heldOutSkins.push({
      heroId: skin.heroId,
      signature: maskedSignature(altered.data, altered.width, altered.height, 8, "ban"),
    });
  }
  const correct = heldOut.filter((sample) => rank(sample.signature, references.banIcons)[0]?.heroId === sample.heroId).length;
  const correctSkins = heldOutSkins.filter((sample) => rank(sample.signature, references.skinPickIcons)[0]?.heroId === sample.heroId).length;
  const replayValidation = await validateReplaySkinRails(references.skinPickIcons);
  const model: DraftHeroModel = {
    version: "0.2",
    trainedAt: new Date().toISOString(),
    source: "installed MLBB Atlas_Hero_Head and Atlas_SkinHeadIcon textures via ADB",
    heroCount: heldOut.length,
    officialSkinHeads: {
      imageCount: heldOutSkins.length,
      heroCount: new Set(heldOutSkins.map((entry) => entry.heroId)).size,
    },
    references,
    validation: {
      examples: heldOut.length,
      correct,
      accuracy: round(heldOut.length ? correct / heldOut.length : 0),
      description: "Held-out compression and brightness augmentation check for official hero-head identities.",
    },
    skinValidation: {
      examples: heldOutSkins.length,
      correct: correctSkins,
      accuracy: round(heldOutSkins.length ? correctSkins / heldOutSkins.length : 0),
      description: "Held-out compression and brightness augmentation check for installed-game SkinHead identities.",
    },
    replayValidation,
  };
  await cache.write(modelFile, model);
  return model;
}

type ReplaySkinSample = {
  id: string;
  frame: string;
  group: "allyPicks" | "enemyPicks";
  slot: number;
  expectedHeroId: number;
  expectedHeroName: string;
};

async function validateReplaySkinRails(references: Reference[]): Promise<DraftHeroModel["replayValidation"]> {
  const config = JSON.parse(await readFile(replayValidationFile, "utf8")) as { samples?: ReplaySkinSample[] };
  const predictions = [];
  for (const sample of config.samples ?? []) {
    const image = sharp(path.resolve(projectRoot, sample.frame));
    const metadata = await image.metadata();
    const width = metadata.width ?? 0;
    const height = metadata.height ?? 0;
    if (!width || !height) continue;
    const cell = railCell(width, height, sample.group, sample.slot);
    const candidates = [];
    for (const [index, crop] of finalPickRects(cell, sample.group).entries()) {
      const { data, info } = await sharp(path.resolve(projectRoot, sample.frame))
        .extract(crop)
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      const ranking = rank(maskedSignature(data, info.width, info.height, 8, "ban"), references);
      const best = ranking[0];
      const second = ranking.find((entry) => entry.heroId !== best?.heroId);
      const margin = best && second ? round(best.confidence - second.confidence) : 0;
      candidates.push({ index, best, margin });
    }
    const selected = candidates.sort((left, right) => (right.best?.confidence ?? 0) - (left.best?.confidence ?? 0))[0];
    const accepted = Boolean(
      selected?.best &&
      selected.best.confidence >= finalPickMinimumConfidence &&
      selected.margin >= finalPickMinimumMargin,
    );
    predictions.push({
      id: sample.id,
      expectedHeroName: sample.expectedHeroName,
      predictedHeroName: accepted ? selected.best?.heroName ?? null : null,
      accepted,
      correct: accepted && selected.best?.heroId === sample.expectedHeroId,
      confidence: round(selected?.best?.confidence ?? 0),
      margin: selected?.margin ?? 0,
      cropIndex: selected?.index ?? null,
      skinId: accepted ? selected.best?.skinId ?? null : null,
    });
  }
  const correct = predictions.filter((prediction) => prediction.correct).length;
  const accepted = predictions.filter((prediction) => prediction.accepted).length;
  return {
    examples: predictions.length,
    correct,
    accepted,
    accuracy: round(predictions.length ? correct / predictions.length : 0),
    description: "Human-confirmed finalized draft rail crop validation using recorded match frames.",
    predictions,
  };
}

function railCell(width: number, height: number, group: ReplaySkinSample["group"], slot: number) {
  const rail = group === "allyPicks"
    ? [0, 0.112, 0.162621, 0.812]
    : [0.842233, 0.112, 0.157767, 0.812];
  return {
    left: Math.round(rail[0] * width),
    top: Math.round((rail[1] + rail[3] * (slot - 1) / 5) * height),
    width: Math.round(rail[2] * width),
    height: Math.round(rail[3] / 5 * height),
  };
}

function finalPickRects(cell: { left: number; top: number; width: number; height: number }, group: ReplaySkinSample["group"]) {
  const rectangles = [
    squareRect(cell, 0.37, 0.18, 0.58),
    squareRect(cell, 0.39, 0.22, 0.52),
    squareRect(cell, 0.39, 0.27, 0.52),
    squareRect(cell, 0.42, 0.27, 0.48),
  ];
  rectangles.push(...(group === "allyPicks"
    ? [relativeRect(cell, 0.3, 0.04, 0.67, 0.72), relativeRect(cell, 0.33, 0.18, 0.58, 0.68)]
    : [relativeRect(cell, 0.2, 0.04, 0.67, 0.72), relativeRect(cell, 0.22, 0.18, 0.62, 0.68)]));
  return rectangles;
}

function squareRect(cell: { left: number; top: number; width: number; height: number }, x: number, y: number, scale: number) {
  const side = Math.max(1, Math.round(cell.height * scale));
  return {
    left: cell.left + Math.max(0, Math.min(cell.width - side, Math.round(cell.width * x))),
    top: cell.top + Math.max(0, Math.min(cell.height - side, Math.round(cell.height * y))),
    width: side,
    height: side,
  };
}

function relativeRect(cell: { left: number; top: number; width: number; height: number }, x: number, y: number, width: number, height: number) {
  const left = Math.round(cell.width * x);
  const top = Math.round(cell.height * y);
  return {
    left: cell.left + left,
    top: cell.top + top,
    width: Math.max(1, Math.min(cell.width - left, Math.round(cell.width * width))),
    height: Math.max(1, Math.min(cell.height - top, Math.round(cell.height * height))),
  };
}

async function rawIcon(image: Buffer) {
  const { data, info } = await sharp(image).resize(64, 64).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

function reference(
  heroId: number,
  heroName: string,
  variant: Reference["variant"],
  signature: number[],
  skinId?: string,
  source?: Reference["source"],
) {
  return { heroId, heroName, variant, signature, ...(skinId ? { skinId } : {}), ...(source ? { source } : {}) };
}

function maskedSignature(rgba: Buffer, width: number, height: number, gridSize: number, mask: "ban" | "pick") {
  const output: number[] = [];
  for (let gy = 0; gy < gridSize; gy += 1) {
    for (let gx = 0; gx < gridSize; gx += 1) {
      let red = 0;
      let green = 0;
      let blue = 0;
      let count = 0;
      const startX = Math.floor((gx / gridSize) * width);
      const endX = Math.max(startX + 1, Math.floor(((gx + 1) / gridSize) * width));
      const startY = Math.floor((gy / gridSize) * height);
      const endY = Math.max(startY + 1, Math.floor(((gy + 1) / gridSize) * height));
      for (let y = startY; y < Math.min(height, endY); y += 1) {
        for (let x = startX; x < Math.min(width, endX); x += 1) {
          const dx = (x + 0.5) / width - 0.5;
          const dy = (y + 0.5) / height - 0.5;
          if (dx * dx + dy * dy > 0.245) continue;
          if (mask === "ban" && (dx - 0.27) ** 2 + (dy - 0.24) ** 2 < 0.045) continue;
          if (mask === "pick" && (
            (dx + 0.28) ** 2 + (dy + 0.26) ** 2 < 0.052
            || (dx - 0.28) ** 2 + (dy + 0.26) ** 2 < 0.052
            || (dx + 0.28) ** 2 + (dy - 0.26) ** 2 < 0.052
          )) continue;
          const index = (y * width + x) * 4;
          if (rgba[index + 3] < 24) continue;
          red += rgba[index];
          green += rgba[index + 1];
          blue += rgba[index + 2];
          count += 1;
        }
      }
      output.push(round(count ? red / count / 255 : 0));
      output.push(round(count ? green / count / 255 : 0));
      output.push(round(count ? blue / count / 255 : 0));
    }
  }
  return output;
}

function mirrorSignature(signature: number[], gridSize: number) {
  const output: number[] = [];
  for (let y = 0; y < gridSize; y += 1) {
    for (let x = gridSize - 1; x >= 0; x -= 1) {
      const index = (y * gridSize + x) * 3;
      output.push(...signature.slice(index, index + 3));
    }
  }
  return output;
}

function rank(signature: number[], references: Reference[]) {
  return references
    .map((entry) => ({ ...entry, confidence: similarity(signature, entry.signature) }))
    .sort((left, right) => right.confidence - left.confidence);
}

function similarity(left: number[], right: number[]) {
  const squaredError = left.reduce((sum, value, index) => sum + (value - right[index]) ** 2, 0);
  return Math.max(0, Math.min(1, 1 - Math.sqrt(squaredError / left.length) * 1.5));
}

function round(value: number) {
  return Math.round(value * 10000) / 10000;
}
