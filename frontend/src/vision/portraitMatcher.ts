export type HeroPortraitReference = {
  heroId: number;
  heroName: string;
  variant: "normal" | "mirror-x";
  signature: number[];
};

export type HeroPortraitRanking = {
  heroId: number;
  heroName: string;
  variant: "normal" | "mirror-x";
  confidence: number;
};

export function portraitSignatureFromRgba(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  columns = 6,
  rows = 8,
) {
  const output: number[] = [];
  for (let gy = 0; gy < rows; gy += 1) {
    for (let gx = 0; gx < columns; gx += 1) {
      let red = 0;
      let green = 0;
      let blue = 0;
      let count = 0;
      const startX = Math.floor((gx / columns) * width);
      const endX = Math.max(startX + 1, Math.floor(((gx + 1) / columns) * width));
      const startY = Math.floor((gy / rows) * height);
      const endY = Math.max(startY + 1, Math.floor(((gy + 1) / rows) * height));
      for (let y = startY; y < Math.min(height, endY); y += 1) {
        for (let x = startX; x < Math.min(width, endX); x += 1) {
          const nx = (x + 0.5) / width;
          const ny = (y + 0.5) / height;
          if (nx < 0.14 || nx > 0.86 || ny < 0.08 || ny > 0.82) continue;
          const index = (y * width + x) * 4;
          if (rgba[index + 3] < 24) continue;
          red += rgba[index];
          green += rgba[index + 1];
          blue += rgba[index + 2];
          count += 1;
        }
      }
      output.push(count ? red / count / 255 : 0);
      output.push(count ? green / count / 255 : 0);
      output.push(count ? blue / count / 255 : 0);
    }
  }
  return output;
}

export function mirrorPortraitSignature(signature: number[], columns = 6, rows = 8) {
  const output: number[] = [];
  for (let y = 0; y < rows; y += 1) {
    for (let x = columns - 1; x >= 0; x -= 1) {
      const start = (y * columns + x) * 3;
      output.push(...signature.slice(start, start + 3));
    }
  }
  return output;
}

export function draftBannerSignatureFromRgba(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  columns = 30,
  rows = 20,
) {
  const luma: number[] = [];
  for (let gy = 0; gy < rows; gy += 1) {
    for (let gx = 0; gx < columns; gx += 1) {
      let value = 0;
      let count = 0;
      const startX = Math.floor((gx / columns) * width);
      const endX = Math.max(startX + 1, Math.floor(((gx + 1) / columns) * width));
      const startY = Math.floor((gy / rows) * height);
      const endY = Math.max(startY + 1, Math.floor(((gy + 1) / rows) * height));
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
  const mean = luma.reduce((sum, value) => sum + value, 0) / Math.max(1, luma.length);
  const deviation = Math.sqrt(
    luma.reduce((sum, value) => sum + (value - mean) ** 2, 0) / Math.max(1, luma.length),
  ) || 1;
  return luma.map((value) => (value - mean) / deviation);
}

export function mirrorDraftBannerSignature(signature: number[], columns = 30, rows = 20) {
  const output: number[] = [];
  for (let y = 0; y < rows; y += 1) {
    for (let x = columns - 1; x >= 0; x -= 1) output.push(signature[y * columns + x]);
  }
  return output;
}

export function rankDraftBannerCandidates(signature: number[], references: HeroPortraitReference[]) {
  return references
    .map((reference) => {
      let correlation = 0;
      for (let index = 0; index < signature.length; index += 1) correlation += signature[index] * reference.signature[index];
      correlation /= Math.max(1, signature.length);
      return {
        heroId: reference.heroId,
        heroName: reference.heroName,
        variant: reference.variant,
        confidence: Math.max(0, Math.min(1, (correlation + 1) / 2)),
      };
    })
    .sort((left, right) => right.confidence - left.confidence);
}

function mergePortraitRankings(...rankings: ReturnType<typeof rankDraftBannerCandidates>[]) {
  const merged = new Map<number, ReturnType<typeof rankDraftBannerCandidates>[number]>();
  for (const ranked of rankings) {
    for (const entry of ranked) {
      const previous = merged.get(entry.heroId);
      if (!previous || entry.confidence > previous.confidence) merged.set(entry.heroId, entry);
    }
  }
  return [...merged.values()].sort((left, right) => right.confidence - left.confidence);
}

export function rankOrientedDraftBannerCandidates(signature: number[], references: HeroPortraitReference[]) {
  return mergePortraitRankings(
    rankDraftBannerCandidates(signature, references),
    rankDraftBannerCandidates(mirrorDraftBannerSignature(signature), references),
  );
}

function similarity(a: number[], b: number[]) {
  if (!a.length || a.length !== b.length) return 0;
  let squaredError = 0;
  for (let index = 0; index < a.length; index += 1) squaredError += (a[index] - b[index]) ** 2;
  return Math.max(0, Math.min(1, 1 - Math.sqrt(squaredError / a.length) * 1.65));
}

export function rankPortraitCandidates(signature: number[], references: HeroPortraitReference[]) {
  return references
    .map((reference) => ({
      heroId: reference.heroId,
      heroName: reference.heroName,
      variant: reference.variant,
      confidence: similarity(signature, reference.signature),
    }))
    .sort((a, b) => b.confidence - a.confidence);
}

export function acceptPortraitMatch(
  ranking: HeroPortraitRanking[],
  minimumConfidence = 0.8,
  minimumMargin = 0.035,
) {
  const best = ranking[0];
  const second = ranking.find((candidate) => candidate.heroId !== best?.heroId);
  if (!best || best.confidence < minimumConfidence) return null;
  if (second && best.confidence - second.confidence < minimumMargin) return null;
  return best;
}
