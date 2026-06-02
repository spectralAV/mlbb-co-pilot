import { eventBus } from "../event-bus/eventBus.js";
import { resetDraftSlotStabilizer, stabilizeDraftSlotGroup } from "./draftStabilizer.js";

export const DETECTED_FACT_CONFIDENCE = 0.55;

type DetectedSlot = {
  heroId?: number;
  heroName?: string;
  slot?: number;
  confidence: number;
  variant?: "normal" | "mirror-x";
  source?: string;
};

type DetectedContext<T> = {
  value: T;
  confidence: number;
  source: string;
};

type DetectedBattleSpell = {
  spell: string;
  slot: number;
  confidence: number;
  source: string;
};

type DetectedAllyLane = {
  lane: string;
  slot: number;
  confidence: number;
  source: string;
};

type DraftState = {
  phase: string;
  allyPicks: DetectedSlot[];
  enemyPicks: DetectedSlot[];
  allyBans: DetectedSlot[];
  enemyBans: DetectedSlot[];
  allySpells: DetectedBattleSpell[];
  allyLanes: DetectedAllyLane[];
  selectedLane: DetectedContext<string> | null;
  selfSlot: DetectedContext<number> | null;
  firstPickSide: DetectedContext<"ally" | "enemy"> | null;
  confidence: number;
  analysis: unknown | null;
  frameId?: string;
  detectedAt: number;
};

export type MatchState = {
  revision: number;
  lifecycle: {
    screen: string;
    confidence: number;
    source: string;
    timestamp: number;
  } | null;
  vision: any | null;
  reasoning: any | null;
  draft: DraftState | null;
  confidence: {
    minimum: number;
    visionTrusted: boolean;
    draftTrusted: boolean;
    reasoningTrusted: boolean;
  };
  updatedAt: string;
};

function initialState(): MatchState {
  return {
    revision: 0,
    lifecycle: null,
    vision: null,
    reasoning: null,
    draft: null,
    confidence: {
      minimum: DETECTED_FACT_CONFIDENCE,
      visionTrusted: false,
      draftTrusted: false,
      reasoningTrusted: false,
    },
    updatedAt: new Date(0).toISOString(),
  };
}

let latest = initialState();

export function getMatchState() {
  return latest;
}

export function resetMatchState() {
  resetDraftSlotStabilizer();
  latest = initialState();
  return latest;
}

function emit(next: MatchState) {
  latest = next;
  eventBus.emit("match_state_updated", next);
  return next;
}

export function updateMatchVision(vision: any, reasoning: any) {
  const confidence = Number(vision?.confidence ?? 0);
  const visionTrusted = confidence >= DETECTED_FACT_CONFIDENCE && vision?.screen !== "unknown";
  const activeDraft = String(vision?.screen ?? "unknown") === "draft";
  const draftTrusted = visionTrusted && !activeDraft ? false : latest.confidence.draftTrusted;
  const reasoningTrusted =
    visionTrusted &&
    Number(reasoning?.confidence ?? confidence) >= DETECTED_FACT_CONFIDENCE &&
    reasoning?.ruleId !== "confidence_gate";

  return emit({
    ...latest,
    revision: latest.revision + 1,
    lifecycle: {
      screen: String(vision?.screen ?? "unknown"),
      confidence,
      source: String(vision?.source ?? "unknown"),
      timestamp: Number(vision?.timestamp ?? Date.now()),
    },
    vision,
    reasoning,
    confidence: {
      ...latest.confidence,
      visionTrusted,
      draftTrusted,
      reasoningTrusted,
    },
    updatedAt: new Date().toISOString(),
  });
}

function acceptedSlots(slots: unknown, expectedSource: "draft-ban-icon" | "draft-pick-portrait"): DetectedSlot[] {
  if (!Array.isArray(slots)) return [];
  return slots
    .map((slot: any) => ({
      heroId: Number.isFinite(Number(slot?.heroId)) ? Number(slot.heroId) : undefined,
      heroName: typeof slot?.heroName === "string" ? slot.heroName : undefined,
      slot: Number.isInteger(Number(slot?.slot)) && Number(slot.slot) >= 1 && Number(slot.slot) <= 5 ? Number(slot.slot) : undefined,
      confidence: Number(slot?.confidence ?? 0),
      variant: slot?.variant,
      source: slot?.source,
    }))
    .filter(
      (slot) =>
        slot.source === expectedSource &&
        (slot.heroId !== undefined || Boolean(slot.heroName)) &&
        slot.confidence >= DETECTED_FACT_CONFIDENCE,
    );
}

function acceptedSubmittedSlotFacts(submitted: unknown, accepted: DetectedSlot[]) {
  if (!Array.isArray(submitted)) return [];
  const submittedKeys = new Set(submitted.map(submittedSlotKey).filter(Boolean));
  return accepted.filter((slot) => submittedKeys.has(submittedSlotKey(slot)));
}

function acceptedContext<T>(
  fact: any,
  source: string,
  normalize: (value: unknown) => T | null,
): DetectedContext<T> | null {
  const value = normalize(fact?.value);
  const confidence = Number(fact?.confidence ?? 0);
  return fact?.source === source && value !== null && confidence >= DETECTED_FACT_CONFIDENCE
    ? { value, confidence, source }
    : null;
}

function acceptedSpells(spells: unknown): DetectedBattleSpell[] {
  if (!Array.isArray(spells)) return [];
  return spells
    .map((fact: any) => ({
      spell: String(fact?.spell ?? "").trim(),
      slot: Number(fact?.slot),
      confidence: Number(fact?.confidence ?? 0),
      source: String(fact?.source ?? ""),
    }))
    .filter((fact) =>
      fact.source === "draft-battle-spell-icon" &&
      Boolean(fact.spell) &&
      Number.isInteger(fact.slot) &&
      fact.slot >= 1 &&
      fact.slot <= 5 &&
      fact.confidence >= DETECTED_FACT_CONFIDENCE
    );
}

function acceptedAllyLanes(lanes: unknown): DetectedAllyLane[] {
  if (!Array.isArray(lanes)) return [];
  return lanes
    .map((fact: any) => ({
      lane: String(fact?.lane ?? "").toLowerCase(),
      slot: Number(fact?.slot),
      confidence: Number(fact?.confidence ?? 0),
      source: String(fact?.source ?? ""),
    }))
    .filter((fact) =>
      fact.source === "draft-lane-icon" &&
      ["exp", "jungle", "mid", "roam", "gold"].includes(fact.lane) &&
      Number.isInteger(fact.slot) &&
      fact.slot >= 1 &&
      fact.slot <= 5 &&
      fact.confidence >= DETECTED_FACT_CONFIDENCE
    );
}

function submittedSlotKey(slot: any) {
  if (!slot || typeof slot !== "object") return "";
  if (Number.isFinite(Number(slot.heroId))) return `id:${Number(slot.heroId)}`;
  const name = typeof slot.heroName === "string" ? slot.heroName : "";
  return name ? `name:${name.toLowerCase()}` : "";
}

export function updateMatchDraft(recognition: any) {
  const source = recognition?.state ?? {};
  if (String(source.phase ?? "") === "ban" && latest.draft?.phase !== "ban") resetDraftSlotStabilizer();
  const preserve = source.provisional === true && latest.confidence.draftTrusted ? latest.draft : null;
  const rawAllyPicks = acceptedSlots(source.allyPicks, "draft-pick-portrait");
  const rawEnemyPicks = acceptedSlots(source.enemyPicks, "draft-pick-portrait");
  const rawAllyBans = acceptedSlots(source.allyBans, "draft-ban-icon");
  const rawEnemyBans = acceptedSlots(source.enemyBans, "draft-ban-icon");
  const detectedAllyPicks = stabilizeDraftSlotGroup("allyPicks", rawAllyPicks);
  const detectedEnemyPicks = stabilizeDraftSlotGroup("enemyPicks", rawEnemyPicks);
  const detectedAllyBans = stabilizeDraftSlotGroup("allyBans", rawAllyBans);
  const detectedEnemyBans = stabilizeDraftSlotGroup("enemyBans", rawEnemyBans);
  const detectedAllySpells = acceptedSpells(source.allySpells);
  const detectedAllyLanes = acceptedAllyLanes(source.allyLanes);
  const detectedSelectedLane = acceptedContext(source.selectedLane, "draft-lane-icon", (value) => {
    const lane = String(value ?? "").toLowerCase();
    return ["exp", "jungle", "mid", "roam", "gold"].includes(lane) ? lane : null;
  });
  const detectedSelfSlot = acceptedContext(source.selfSlot, "draft-self-highlight", (value) => {
    const slot = Number(value);
    return Number.isInteger(slot) && slot >= 1 && slot <= 5 ? slot : null;
  });
  const detectedFirstPickSide = acceptedContext(source.firstPickSide, "draft-first-pick-indicator", (value) =>
    value === "ally" || value === "enemy" ? value : null
  );
  const allyPicks = detectedAllyPicks.length || !preserve ? detectedAllyPicks : preserve.allyPicks;
  const enemyPicks = detectedEnemyPicks.length || !preserve ? detectedEnemyPicks : preserve.enemyPicks;
  const allyBans = detectedAllyBans.length || !preserve ? detectedAllyBans : preserve.allyBans;
  const enemyBans = detectedEnemyBans.length || !preserve ? detectedEnemyBans : preserve.enemyBans;
  const allySpells = detectedAllySpells.length || !preserve ? detectedAllySpells : preserve.allySpells;
  const allyLanes = detectedAllyLanes.length || !preserve ? detectedAllyLanes : preserve.allyLanes;
  let selectedLane = detectedSelectedLane ?? preserve?.selectedLane ?? null;
  const selfSlot = detectedSelfSlot ?? preserve?.selfSlot ?? null;
  if (!selectedLane && selfSlot) {
    const selfLane = allyLanes.find((fact) => fact.slot === selfSlot.value);
    if (selfLane) {
      selectedLane = {
        value: selfLane.lane,
        confidence: Math.min(selfLane.confidence, selfSlot.confidence),
        source: "draft-lane-icon",
      };
    }
  }
  // Pick order is immutable for an active draft even when later phases hide its badge.
  const firstPickSide = detectedFirstPickSide ?? (latest.confidence.draftTrusted ? latest.draft?.firstPickSide ?? null : null);
  const allSlots = [...allyPicks, ...enemyPicks, ...allyBans, ...enemyBans];
  const allContext = [selectedLane, selfSlot, firstPickSide].filter(Boolean) as Array<DetectedContext<any>>;
  const allFacts = [...allSlots, ...allyLanes, ...allySpells, ...allContext];
  const submittedSlots = [source.allyPicks, source.enemyPicks, source.allyBans, source.enemyBans]
    .flatMap((slots) => Array.isArray(slots) ? slots : [])
    .filter((slot: any) => slot?.heroId !== undefined || Boolean(slot?.heroName));
  const submittedContext = [source.selectedLane, source.selfSlot, source.firstPickSide]
    .filter((fact: any) => fact?.value !== undefined);
  const submittedSpells = Array.isArray(source.allySpells) ? source.allySpells.filter((fact: any) => fact?.spell) : [];
  const submittedLanes = Array.isArray(source.allyLanes) ? source.allyLanes.filter((fact: any) => fact?.lane) : [];
  const acceptedSubmittedSlots = [
    ...acceptedSubmittedSlotFacts(source.allyPicks, detectedAllyPicks),
    ...acceptedSubmittedSlotFacts(source.enemyPicks, detectedEnemyPicks),
    ...acceptedSubmittedSlotFacts(source.allyBans, detectedAllyBans),
    ...acceptedSubmittedSlotFacts(source.enemyBans, detectedEnemyBans),
  ];
  const acceptedSubmittedContext = [detectedSelectedLane, detectedSelfSlot, detectedFirstPickSide].filter(Boolean);
  const submittedFactCount = submittedSlots.length + submittedLanes.length + submittedSpells.length + submittedContext.length;
  const acceptedSubmittedFactCount =
    acceptedSubmittedSlots.length + detectedAllyLanes.length + detectedAllySpells.length + acceptedSubmittedContext.length;
  const evidenceFullyAccepted = submittedFactCount === acceptedSubmittedFactCount;
  const draftTrusted = allFacts.length > 0;
  const hasPickEvidence = allyPicks.length + enemyPicks.length > 0;
  const confidence = draftTrusted
    ? allFacts.reduce((sum, fact) => sum + fact.confidence, 0) / allFacts.length
    : 0;

  return emit({
    ...latest,
    revision: latest.revision + 1,
    draft: {
      phase: String(source.phase ?? "unknown"),
      allyPicks,
      enemyPicks,
      allyBans,
      enemyBans,
      allySpells,
      allyLanes,
      selectedLane,
      selfSlot,
      firstPickSide,
      confidence,
      analysis: preserve?.analysis ?? (draftTrusted && evidenceFullyAccepted && hasPickEvidence ? recognition?.analysis ?? null : null),
      frameId: source.frameId,
      detectedAt: Number(source.timestamp ?? Date.now()),
    },
    confidence: {
      ...latest.confidence,
      draftTrusted,
    },
    updatedAt: new Date().toISOString(),
  });
}
