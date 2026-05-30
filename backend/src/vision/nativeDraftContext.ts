import { firstNormalizedRegion, type NormalizedRect } from "../services/obsCoachState.js";
import { isRawVideoFrame, rawFrameBytesPerPixel, type RawVideoFrame, type VisionFrameInput } from "./rawFrame.js";

type Rect = NormalizedRect;
type ContextFact<T> = {
  value: T;
  confidence: number;
  source: "draft-self-highlight" | "draft-first-pick-indicator";
};

export type NativeDraftVisualContext = {
  selfSlot?: ContextFact<number>;
  firstPickSide?: ContextFact<"ally" | "enemy">;
};

const defaultSelfRail: Rect = [0, 0.112, 0.162621, 0.812];
const defaultFirstPickMarkers: Record<"ally" | "enemy", Rect> = {
  ally: [0.278, 0.032, 0.052, 0.072],
  enemy: [0.702, 0.032, 0.052, 0.072],
};

export function detectNativeDraftVisualContext(input: VisionFrameInput, calibratedRegions: Record<string, unknown> = {}): NativeDraftVisualContext {
  const image = imageFromFrameInput(input);
  if (!image) return {};
  const selfRail = firstNormalizedRegion(calibratedRegions.draft_self_highlight_rail_norm) ?? defaultSelfRail;
  const firstPickMarkers = {
    ally: firstNormalizedRegion(calibratedRegions.draft_first_pick_ally_indicator_norm) ?? defaultFirstPickMarkers.ally,
    enemy: firstNormalizedRegion(calibratedRegions.draft_first_pick_enemy_indicator_norm) ?? defaultFirstPickMarkers.enemy,
  };
  const selfSlot = detectSelfSlot(image, selfRail);
  const firstPickSide = detectFirstPickSide(image, firstPickMarkers);
  return {
    ...(selfSlot ? { selfSlot } : {}),
    ...(firstPickSide ? { firstPickSide } : {}),
  };
}

type BmpImage = {
  width: number;
  height: number;
  colorAt: (x: number, y: number) => [number, number, number];
};

function parseBmp(buffer: Buffer): BmpImage | null {
  if (buffer.length < 54 || buffer.toString("ascii", 0, 2) !== "BM") return null;
  const pixelOffset = buffer.readUInt32LE(10);
  const width = Math.abs(buffer.readInt32LE(18));
  const rawHeight = buffer.readInt32LE(22);
  const height = Math.abs(rawHeight);
  const bitsPerPixel = buffer.readUInt16LE(28);
  const compression = buffer.readUInt32LE(30);
  if (!width || !height || ![24, 32].includes(bitsPerPixel) || ![0, 3].includes(compression)) return null;
  const bytesPerPixel = bitsPerPixel / 8;
  const rowStride = Math.ceil((width * bytesPerPixel) / 4) * 4;
  if (pixelOffset + rowStride * height > buffer.length) return null;
  return {
    width,
    height,
    colorAt: (x, y) => {
      const sourceY = rawHeight > 0 ? height - y - 1 : y;
      const index = pixelOffset + sourceY * rowStride + x * bytesPerPixel;
      return [buffer[index + 2], buffer[index + 1], buffer[index]];
    },
  };
}

function imageFromFrameInput(input: VisionFrameInput): BmpImage | null {
  if (isRawVideoFrame(input)) return rawImage(input);
  return parseBmp(input);
}

function rawImage(frame: RawVideoFrame): BmpImage | null {
  const bytesPerPixel = rawFrameBytesPerPixel(frame.pixelFormat);
  if (frame.buffer.byteLength !== frame.width * frame.height * bytesPerPixel) return null;
  return {
    width: frame.width,
    height: frame.height,
    colorAt: (x, y) => {
      const index = (y * frame.width + x) * bytesPerPixel;
      switch (frame.pixelFormat) {
      case "BGRA":
      case "BGRX":
      case "BGR":
        return [frame.buffer[index + 2], frame.buffer[index + 1], frame.buffer[index]];
      case "RGBA":
      case "RGBX":
      case "RGB":
        return [frame.buffer[index], frame.buffer[index + 1], frame.buffer[index + 2]];
      }
    },
  };
}

function detectSelfSlot(image: BmpImage, selfRail: Rect) {
  const scores = Array.from({ length: 5 }, (_, index) => {
    const rowTop = selfRail[1] + selfRail[3] * index / 5;
    const rowHeight = selfRail[3] / 5;
    const rowRect: Rect = [selfRail[0] + 0.04, rowTop + rowHeight * 0.62, selfRail[2] - 0.062621, rowHeight * 0.32];
    return ratioInRect(image, rowRect, (red, green, blue) =>
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

function detectFirstPickSide(image: BmpImage, firstPickMarkers: Record<"ally" | "enemy", Rect>) {
  const scores = (Object.keys(firstPickMarkers) as Array<"ally" | "enemy">).map((side) => ({
    value: side,
    score: ratioInRect(image, firstPickMarkers[side], (red, green, blue) => {
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
  image: BmpImage,
  rect: Rect,
  match: (red: number, green: number, blue: number) => boolean,
) {
  const x0 = Math.max(0, Math.floor(rect[0] * image.width));
  const y0 = Math.max(0, Math.floor(rect[1] * image.height));
  const x1 = Math.min(image.width, Math.ceil((rect[0] + rect[2]) * image.width));
  const y1 = Math.min(image.height, Math.ceil((rect[1] + rect[3]) * image.height));
  const step = Math.max(1, Math.floor(Math.min(image.width, image.height) / 640));
  let matching = 0;
  let sampled = 0;
  for (let y = y0; y < y1; y += step) {
    for (let x = x0; x < x1; x += step) {
      const [red, green, blue] = image.colorAt(x, y);
      if (match(red, green, blue)) matching += 1;
      sampled += 1;
    }
  }
  return sampled ? matching / sampled : 0;
}
