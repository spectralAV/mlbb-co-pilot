export type HeroIconVariant = "normal" | "mirror-x";
export type HeroIconReference = {
  heroId: number;
  heroName: string;
  variant: HeroIconVariant;
  signature: number[];
};
export type HeroIconRanking = {
  heroId: number;
  heroName: string;
  variant: HeroIconVariant;
  confidence: number;
};

export function iconSignatureFromRgba(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  gridSize = 16,
) {
  return maskedIconSignatureFromRgba(rgba, width, height, gridSize, "ban");
}

export function pickIconSignatureFromRgba(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  gridSize = 8,
) {
  return maskedIconSignatureFromRgba(rgba, width, height, gridSize, "pick");
}

export function spellIconSignatureFromRgba(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  gridSize = 6,
) {
  return maskedIconSignatureFromRgba(rgba, width, height, gridSize, "spell");
}

function maskedIconSignatureFromRgba(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  gridSize: number,
  mask: "ban" | "pick" | "spell",
) {
  const output: number[] = [];
  const radiusSquared = mask === "spell" ? 0.1024 : 0.245;
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
          if (dx * dx + dy * dy > radiusSquared) continue;
          if (mask === "ban" && (dx - 0.27) ** 2 + (dy - 0.24) ** 2 < 0.045) continue;
          // Confirmed ally rows stamp flag, battle spell and lane badges over the thumbnail corners.
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
      output.push(count ? red / count / 255 : 0);
      output.push(count ? green / count / 255 : 0);
      output.push(count ? blue / count / 255 : 0);
    }
  }
  return output;
}

export function mirrorIconSignature(signature: number[], gridSize = 16) {
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

export function rankIconCandidates(signature: number[], references: HeroIconReference[]) {
  return references
    .map((reference) => ({
      heroId: reference.heroId,
      heroName: reference.heroName,
      variant: reference.variant,
      confidence: similarity(signature, reference.signature),
    }))
    .sort((a, b) => b.confidence - a.confidence);
}

function mergeIconRankings(...rankings: ReturnType<typeof rankIconCandidates>[]) {
  const merged = new Map<number, ReturnType<typeof rankIconCandidates>[number]>();
  for (const ranked of rankings) {
    for (const entry of ranked) {
      const previous = merged.get(entry.heroId);
      if (!previous || entry.confidence > previous.confidence) merged.set(entry.heroId, entry);
    }
  }
  return [...merged.values()].sort((left, right) => right.confidence - left.confidence);
}

/** Score a crop against both facing directions; references keep normal and mirror-x variants. */
export function rankOrientedIconCandidates(
  signature: number[],
  references: HeroIconReference[],
  gridSize = 16,
) {
  return mergeIconRankings(
    rankIconCandidates(signature, references),
    rankIconCandidates(mirrorIconSignature(signature, gridSize), references),
  );
}

export function acceptIconMatch(
  ranking: HeroIconRanking[],
  minimumConfidence = 0.76,
  minimumMargin = 0.025,
) {
  const best = ranking[0];
  const second = ranking.find((candidate) => candidate.heroId !== best?.heroId);
  if (!best || best.confidence < minimumConfidence) return null;
  if (second && best.confidence - second.confidence < minimumMargin) return null;
  return best;
}

/** Ban heads on 20:9 often score ~0.71–0.75 for the correct hero; accept when the lead is decisive. */
export function acceptBanIconMatch(ranking: HeroIconRanking[]) {
  const accepted = acceptIconMatch(ranking, 0.76, 0.012);
  if (accepted) return accepted;
  const best = ranking[0];
  const second = ranking.find((candidate) => candidate.heroId !== best?.heroId);
  if (!best || !second) return null;
  const margin = best.confidence - second.confidence;
  if (best.confidence >= 0.7 && margin >= 0.034) return best;
  return null;
}
