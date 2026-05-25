export type PortraitVariant = "normal" | "mirror-x";
export type PortraitReference = {
  heroId: number;
  heroName: string;
  variant: PortraitVariant;
  signature: number[];
};
export type PortraitRanking = {
  heroId: number;
  heroName: string;
  variant: PortraitVariant;
  confidence: number;
};

export function portraitSignatureFromRgba(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  gridSize = 8,
) {
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

export function mirrorPortraitSignature(signature: number[], gridSize = 8) {
  const output: number[] = [];
  const channels = 3;
  for (let y = 0; y < gridSize; y += 1) {
    for (let x = gridSize - 1; x >= 0; x -= 1) {
      const start = (y * gridSize + x) * channels;
      output.push(...signature.slice(start, start + channels));
    }
  }
  return output;
}

function similarity(a: number[], b: number[]) {
  if (!a.length || a.length !== b.length) return 0;
  let squaredError = 0;
  for (let i = 0; i < a.length; i += 1) squaredError += (a[i] - b[i]) ** 2;
  const rootMeanSquaredError = Math.sqrt(squaredError / a.length);
  return Math.max(0, Math.min(1, 1 - rootMeanSquaredError * 1.5));
}

export function rankPortraitCandidates(signature: number[], references: PortraitReference[]) {
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
  ranking: PortraitRanking[],
  minimumConfidence = 0.76,
  minimumMargin = 0.025,
) {
  const best = ranking[0];
  const second = ranking.find((candidate) => candidate.heroId !== best?.heroId);
  if (!best || best.confidence < minimumConfidence) return null;
  if (second && best.confidence - second.confidence < minimumMargin) return null;
  return best;
}
