import sharp from "sharp";
import { cache } from "../services/cacheService.js";
import { getHeroRecognitionManifest } from "./heroRecognition.js";

const modelFile = "cv-draft-banner-model.json";
const BANNER_COLUMNS = 30;
const BANNER_ROWS = 20;

export type DraftBannerReference = {
  heroId: number;
  heroName: string;
  variant: "normal" | "mirror-x";
  signature: number[];
};

export type DraftBannerModel = {
  version: string;
  trainedAt: string;
  source: string;
  heroCount: number;
  manifestHeroCount: number;
  missingPortraitHeroIds: number[];
  references: DraftBannerReference[];
};

export async function getDraftBannerModel() {
  return cache.read<DraftBannerModel | null>(modelFile, null);
}

export async function ensureDraftBannerModel() {
  const cached = await getDraftBannerModel();
  if (cached?.references?.length) return cached;
  return trainDraftBannerModel();
}

export async function getDraftBannerModelStatus() {
  const model = await getDraftBannerModel();
  return { available: Boolean(model?.references?.length), model };
}

export async function trainDraftBannerModel() {
  const manifest = await getHeroRecognitionManifest();
  const references: DraftBannerReference[] = [];
  const missingPortraitHeroIds: number[] = [];
  for (const hero of manifest.heroes) {
    if (!hero.portraitUrl) {
      missingPortraitHeroIds.push(hero.id);
      continue;
    }
    const response = await fetch(String(hero.portraitUrl));
    if (!response.ok) {
      missingPortraitHeroIds.push(hero.id);
      continue;
    }
    const image = Buffer.from(await response.arrayBuffer());
    const sourceMeta = await sharp(image).metadata();
    if (!sourceMeta.width || !sourceMeta.height) continue;
    for (const topRatio of [0, 20 / 390, 40 / 390, 60 / 390, 80 / 390, 100 / 390]) {
      const { data, info } = await sharp(image)
        .extract({
          left: 0,
          top: Math.round(sourceMeta.height * topRatio),
          width: sourceMeta.width,
          height: Math.max(1, Math.round(sourceMeta.height * (150 / 390))),
        })
        .resize(BANNER_COLUMNS, BANNER_ROWS)
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      const normal = draftBannerSignatureFromRgba(data, info.width, info.height);
      references.push(
        { heroId: hero.id, heroName: hero.name, variant: "normal", signature: normal },
        { heroId: hero.id, heroName: hero.name, variant: "mirror-x", signature: mirrorDraftBannerSignature(normal) },
      );
    }
  }
  const model: DraftBannerModel = {
    version: "0.2",
    trainedAt: new Date().toISOString(),
    source: "official hero portrait strips for draft pick rails",
    heroCount: new Set(references.map((entry) => entry.heroId)).size,
    manifestHeroCount: manifest.heroes.length,
    missingPortraitHeroIds,
    references,
  };
  await cache.write(modelFile, model);
  return model;
}

function draftBannerSignatureFromRgba(rgba: Buffer, width: number, height: number) {
  const luma: number[] = [];
  for (let gy = 0; gy < BANNER_ROWS; gy += 1) {
    for (let gx = 0; gx < BANNER_COLUMNS; gx += 1) {
      let value = 0;
      let count = 0;
      const startX = Math.floor((gx / BANNER_COLUMNS) * width);
      const endX = Math.max(startX + 1, Math.floor(((gx + 1) / BANNER_COLUMNS) * width));
      const startY = Math.floor((gy / BANNER_ROWS) * height);
      const endY = Math.max(startY + 1, Math.floor(((gy + 1) / BANNER_ROWS) * height));
      for (let y = startY; y < Math.min(height, endY); y += 1) {
        for (let x = startX; x < Math.min(width, endX); x += 1) {
          const index = (y * width + x) * 4;
          if (rgba[index + 3] < 24) continue;
          value += rgba[index] * 0.299 + rgba[index + 1] * 0.587 + rgba[index + 2] * 0.114;
          count += 1;
        }
      }
      luma.push(count ? value / count : 0);
    }
  }
  const mean = luma.reduce((sum, entry) => sum + entry, 0) / Math.max(1, luma.length);
  const deviation = Math.sqrt(luma.reduce((sum, entry) => sum + (entry - mean) ** 2, 0) / Math.max(1, luma.length)) || 1;
  return luma.map((entry) => (entry - mean) / deviation);
}

function mirrorDraftBannerSignature(signature: number[]) {
  const output: number[] = [];
  for (let y = 0; y < BANNER_ROWS; y += 1) {
    for (let x = BANNER_COLUMNS - 1; x >= 0; x -= 1) output.push(signature[y * BANNER_COLUMNS + x]);
  }
  return output;
}
