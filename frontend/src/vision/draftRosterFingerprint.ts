export function slotRowFingerprint(slots: unknown): Array<number | null> {
  const row = Array.from({ length: 5 }, () => null as number | null);
  const list = Array.isArray(slots) ? slots : [];
  for (const [index, slot] of list.entries()) {
    const heroId = typeof slot === "number" ? slot : Number((slot as { heroId?: number })?.heroId);
    if (!Number.isFinite(heroId)) continue;
    const detectedIndex = Number((slot as { slot?: number })?.slot) - 1;
    const destination = Number.isInteger(detectedIndex) && detectedIndex >= 0 && detectedIndex < 5
      ? detectedIndex
      : index;
    if (destination >= 0 && destination < 5) row[destination] = heroId;
  }
  return row;
}

export function rosterFingerprint(input: {
  phase?: string;
  allyPicks?: unknown;
  enemyPicks?: unknown;
  allyBans?: unknown;
  enemyBans?: unknown;
  selectedLane?: unknown;
  selfSlot?: unknown;
  firstPickSide?: unknown;
  laneOrientation?: string;
}) {
  return JSON.stringify({
    phase: String(input.phase ?? "pick"),
    allyPicks: slotRowFingerprint(input.allyPicks),
    enemyPicks: slotRowFingerprint(input.enemyPicks),
    allyBans: slotRowFingerprint(input.allyBans),
    enemyBans: slotRowFingerprint(input.enemyBans),
    selectedLane: contextFingerprint(input.selectedLane),
    selfSlot: contextFingerprint(input.selfSlot),
    firstPickSide: contextFingerprint(input.firstPickSide),
    laneOrientation: input.laneOrientation ?? null,
  });
}

function contextFingerprint(value: unknown): string | number | null {
  if (value == null) return null;
  if (typeof value !== "object") return String(value);
  const record = value as { value?: unknown };
  return record.value == null ? null : String(record.value);
}

export function recognitionPayloadFingerprint(payload: {
  phase?: string;
  allyPicks?: unknown;
  enemyPicks?: unknown;
  allyBans?: unknown;
  enemyBans?: unknown;
  selectedLane?: unknown;
  selfSlot?: unknown;
  firstPickSide?: unknown;
  laneOrientation?: string;
}) {
  return rosterFingerprint(payload);
}
