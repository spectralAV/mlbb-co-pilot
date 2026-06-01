export type NormalizedRect = [number, number, number, number];

const minRectSize = 0.001;

export function normalizeReviewRect(value: unknown): NormalizedRect | null {
  if (!Array.isArray(value) || value.length !== 4) return null;
  const [rawLeft, rawTop, rawWidth, rawHeight] = value.map(Number);
  if (![rawLeft, rawTop, rawWidth, rawHeight].every(Number.isFinite)) return null;

  const left = clamp01(rawLeft);
  const top = clamp01(rawTop);
  const right = clamp01(rawLeft + rawWidth);
  const bottom = clamp01(rawTop + rawHeight);
  const width = right - left;
  const height = bottom - top;
  if (width <= minRectSize || height <= minRectSize) return null;

  return [
    roundRectValue(left),
    roundRectValue(top),
    roundRectValue(width),
    roundRectValue(height),
  ];
}

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}

function roundRectValue(value: number) {
  return Number(value.toFixed(6));
}
