export type NormalizedRect = [number, number, number, number];
export type DraftSlotGroup = "allyPicks" | "enemyPicks" | "allyBans" | "enemyBans";

export type YoloDraftDetection = {
  className: string;
  confidence: number;
  bbox: NormalizedRect;
  center: [number, number];
};

const SLOT_CLASS_TO_GROUP: Record<string, DraftSlotGroup> = {
  ally_pick_slot: "allyPicks",
  enemy_pick_slot: "enemyPicks",
  ally_ban_slot: "allyBans",
  enemy_ban_slot: "enemyBans",
};

const DEFAULT_SLOT_COUNT = 5;
export const DEFAULT_YOLO_SLOT_CONFIDENCE = 0.45;

function clamp01(value: number) {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

function isNormalizedRect(value: unknown): value is NormalizedRect {
  return Array.isArray(value)
    && value.length === 4
    && value.every((coordinate) => typeof coordinate === "number" && Number.isFinite(coordinate));
}

export function splitNormalizedRect(rect: NormalizedRect, index: number, count: number, vertical: boolean): NormalizedRect {
  const [x, y, width, height] = rect;
  if (vertical) return [x, y + (height * index) / count, width, height / count];
  return [x + (width * index) / count, y, width / count, height];
}

function sortAxisForGroup(group: DraftSlotGroup) {
  return group === "allyPicks" || group === "enemyPicks" ? 1 : 0;
}

function orderDetections(group: DraftSlotGroup, detections: YoloDraftDetection[]) {
  const axis = sortAxisForGroup(group);
  return [...detections].sort((left, right) => left.center[axis] - right.center[axis]);
}

/** One YOLO box may be a full rail; split it into per-slot crops when dimensions match a rail, not a single icon. */
export function expandRailBoxIfNeeded(group: DraftSlotGroup, bbox: NormalizedRect, count = DEFAULT_SLOT_COUNT): NormalizedRect[] {
  const [, , width, height] = bbox;
  const vertical = group === "allyPicks" || group === "enemyPicks";
  const looksLikeRail = vertical ? height >= 0.35 : width >= 0.14;
  if (!looksLikeRail) return [bbox];
  return Array.from({ length: count }, (_, index) => splitNormalizedRect(bbox, index, count, vertical));
}

export function yoloBoxesForGroup(
  group: DraftSlotGroup,
  detections: YoloDraftDetection[],
  minConfidence = DEFAULT_YOLO_SLOT_CONFIDENCE,
  count = DEFAULT_SLOT_COUNT,
): NormalizedRect[] {
  const className = Object.entries(SLOT_CLASS_TO_GROUP).find(([, mapped]) => mapped === group)?.[0];
  if (!className) return [];
  const accepted = detections.filter((detection) =>
    detection.className === className && detection.confidence >= minConfidence && isNormalizedRect(detection.bbox),
  );
  const expanded = orderDetections(group, accepted).flatMap((detection) => expandRailBoxIfNeeded(group, detection.bbox, count));
  return expanded.slice(0, count);
}

export function mergeSlotRects(
  fallback: NormalizedRect[],
  yolo: NormalizedRect[],
  count = DEFAULT_SLOT_COUNT,
): { rects: NormalizedRect[]; yoloSlotsUsed: number } {
  let yoloSlotsUsed = 0;
  const rects = Array.from({ length: count }, (_, index) => {
    if (yolo[index]) {
      yoloSlotsUsed += 1;
      return yolo[index];
    }
    return fallback[index];
  });
  return { rects, yoloSlotsUsed };
}

export function resolveDraftSlotRects(
  groups: Record<DraftSlotGroup, { rect: NormalizedRect; count: number; vertical: boolean }>,
  detections: YoloDraftDetection[] | undefined,
  minConfidence = DEFAULT_YOLO_SLOT_CONFIDENCE,
): Record<DraftSlotGroup, NormalizedRect[]> {
  const resolved = {} as Record<DraftSlotGroup, NormalizedRect[]>;
  for (const group of Object.keys(groups) as DraftSlotGroup[]) {
    const config = groups[group];
    const fallback = Array.from(
      { length: config.count },
      (_, index) => splitNormalizedRect(config.rect, index, config.count, config.vertical),
    );
    const yolo = yoloBoxesForGroup(group, detections ?? [], minConfidence, config.count);
    const { rects } = mergeSlotRects(fallback, yolo, config.count);
    resolved[group] = rects.map((rect) => rect.map(clamp01) as NormalizedRect);
  }
  return resolved;
}

function rectsNearlyEqual(left: NormalizedRect, right: NormalizedRect, epsilon = 0.002) {
  return left.every((value, index) => Math.abs(value - right[index]) < epsilon);
}

/** Classify whether a slot crop came from YOLO, saved calibration, or default rails. */
export function resolveSlotGeometrySource(
  rect: NormalizedRect,
  defaultRect: NormalizedRect,
  yoloRect: NormalizedRect | undefined,
): "yolo" | "calibrated" | "default" {
  if (yoloRect && rectsNearlyEqual(rect, yoloRect)) return "yolo";
  if (!rectsNearlyEqual(rect, defaultRect)) return "calibrated";
  return "default";
}

export function countYoloDraftSlots(detections: YoloDraftDetection[] | undefined, minConfidence = DEFAULT_YOLO_SLOT_CONFIDENCE) {
  if (!detections?.length) return 0;
  return (Object.keys(SLOT_CLASS_TO_GROUP) as Array<keyof typeof SLOT_CLASS_TO_GROUP>).reduce((sum, className) => {
    return sum + detections.filter((detection) => detection.className === className && detection.confidence >= minConfidence).length;
  }, 0);
}
