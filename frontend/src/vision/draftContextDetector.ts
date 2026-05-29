import { calibratedRect } from "./calibrationRegions";

type Rect = [number, number, number, number];
type ContextFact<T> = {
  value: T;
  confidence: number;
  source: "draft-self-highlight" | "draft-first-pick-indicator" | "draft-lane-icon";
};

export type DraftVisualContext = {
  selfSlot?: ContextFact<number>;
  firstPickSide?: ContextFact<"ally" | "enemy">;
  selectedLane?: ContextFact<string>;
};

const defaultSelfRail: Rect = [0, 0.112, 0.162621, 0.812];
const defaultFirstPickMarkers: Record<"ally" | "enemy", Rect> = {
  ally: [0.278, 0.032, 0.052, 0.072],
  enemy: [0.702, 0.032, 0.052, 0.072],
};

export function configuredDraftContextRegions() {
  return {
    selfRail: calibratedRect("draft_self_highlight_rail_norm", defaultSelfRail),
    firstPickMarkers: {
      ally: calibratedRect("draft_first_pick_ally_indicator_norm", defaultFirstPickMarkers.ally),
      enemy: calibratedRect("draft_first_pick_enemy_indicator_norm", defaultFirstPickMarkers.enemy),
    },
  };
}

export function detectDraftVisualContext(canvas: HTMLCanvasElement): DraftVisualContext {
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return {};
  const image = context.getImageData(0, 0, canvas.width, canvas.height);
  return detectDraftVisualContextFromRgba(image.data, image.width, image.height);
}

export function detectDraftVisualContextFromRgba(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
): DraftVisualContext {
  const regions = configuredDraftContextRegions();
  const selfSlot = detectSelfSlot(rgba, width, height, regions.selfRail);
  const firstPickSide = detectFirstPickSide(rgba, width, height, regions.firstPickMarkers);
  return {
    ...(selfSlot ? { selfSlot } : {}),
    ...(firstPickSide ? { firstPickSide } : {}),
  };
}

function detectSelfSlot(rgba: Uint8ClampedArray, width: number, height: number, selfRail: Rect) {
  const scores = Array.from({ length: 5 }, (_, index) => {
    const rowTop = selfRail[1] + selfRail[3] * index / 5;
    const rowHeight = selfRail[3] / 5;
    const rowRect: Rect = [selfRail[0] + 0.04, rowTop + rowHeight * 0.62, selfRail[2] - 0.062621, rowHeight * 0.32];
    return ratioInRect(rgba, width, height, rowRect, (red, green, blue) =>
      red > 135 && green > 95 && red > blue * 1.18 && green > blue * 1.05
    );
  });
  const ranking = scores
    .map((score, index) => ({ value: index + 1, score }))
    .sort((left, right) => right.score - left.score);
  const best = ranking[0];
  const margin = best.score - (ranking[1]?.score ?? 0);
  if (best.score < 0.032 || margin < 0.01) return null;
  return {
    value: best.value,
    confidence: Math.min(0.98, 0.58 + margin * 14),
    source: "draft-self-highlight" as const,
  };
}

function detectFirstPickSide(rgba: Uint8ClampedArray, width: number, height: number, firstPickMarkers: Record<"ally" | "enemy", Rect>) {
  const scores = (Object.keys(firstPickMarkers) as Array<"ally" | "enemy">).map((side) => ({
    value: side,
    score: ratioInRect(rgba, width, height, firstPickMarkers[side], (red, green, blue) => {
      const luma = red * 0.299 + green * 0.587 + blue * 0.114;
      const sideColor = side === "ally"
        ? blue > red * 1.15 && blue > 100
        : red > blue * 1.15 && red > 100;
      return luma > 145 || sideColor;
    }),
  })).sort((left, right) => right.score - left.score);
  const best = scores[0];
  const margin = best.score - (scores[1]?.score ?? 0);
  if (best.score < 0.06 || margin < 0.04) return null;
  return {
    value: best.value,
    confidence: Math.min(0.98, 0.58 + margin * 3),
    source: "draft-first-pick-indicator" as const,
  };
}

function ratioInRect(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  rect: Rect,
  match: (red: number, green: number, blue: number) => boolean,
) {
  const x0 = Math.max(0, Math.floor(rect[0] * width));
  const y0 = Math.max(0, Math.floor(rect[1] * height));
  const x1 = Math.min(width, Math.ceil((rect[0] + rect[2]) * width));
  const y1 = Math.min(height, Math.ceil((rect[1] + rect[3]) * height));
  const step = Math.max(1, Math.floor(Math.min(width, height) / 640));
  let matching = 0;
  let sampled = 0;
  for (let y = y0; y < y1; y += step) {
    for (let x = x0; x < x1; x += step) {
      const index = (y * width + x) * 4;
      if (match(rgba[index], rgba[index + 1], rgba[index + 2])) matching += 1;
      sampled += 1;
    }
  }
  return sampled ? matching / sampled : 0;
}
