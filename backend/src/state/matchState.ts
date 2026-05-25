import { eventBus } from "../event-bus/eventBus.js";

export const DETECTED_FACT_CONFIDENCE = 0.55;

type DetectedSlot = {
  heroId?: number;
  heroName?: string;
  confidence: number;
  variant?: "normal" | "mirror-x";
  source?: string;
};

type DraftState = {
  phase: string;
  allyPicks: DetectedSlot[];
  enemyPicks: DetectedSlot[];
  allyBans: DetectedSlot[];
  enemyBans: DetectedSlot[];
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
      reasoningTrusted,
    },
    updatedAt: new Date().toISOString(),
  });
}

function acceptedSlots(slots: unknown): DetectedSlot[] {
  if (!Array.isArray(slots)) return [];
  return slots
    .map((slot: any) => ({
      heroId: Number.isFinite(Number(slot?.heroId)) ? Number(slot.heroId) : undefined,
      heroName: typeof slot?.heroName === "string" ? slot.heroName : undefined,
      confidence: Number(slot?.confidence ?? 0),
      variant: slot?.variant,
      source: slot?.source,
    }))
    .filter(
      (slot) =>
        slot.source !== "manual" &&
        (slot.heroId !== undefined || Boolean(slot.heroName)) &&
        slot.confidence >= DETECTED_FACT_CONFIDENCE,
    );
}

export function updateMatchDraft(recognition: any) {
  const source = recognition?.state ?? {};
  const allyPicks = acceptedSlots(source.allyPicks);
  const enemyPicks = acceptedSlots(source.enemyPicks);
  const allyBans = acceptedSlots(source.allyBans);
  const enemyBans = acceptedSlots(source.enemyBans);
  const allSlots = [...allyPicks, ...enemyPicks, ...allyBans, ...enemyBans];
  const submittedSlots = [source.allyPicks, source.enemyPicks, source.allyBans, source.enemyBans]
    .flatMap((slots) => Array.isArray(slots) ? slots : [])
    .filter((slot: any) => slot?.heroId !== undefined || Boolean(slot?.heroName));
  const evidenceFullyAccepted = submittedSlots.length === allSlots.length;
  const draftTrusted = allSlots.length > 0;
  const confidence = draftTrusted
    ? allSlots.reduce((sum, slot) => sum + slot.confidence, 0) / allSlots.length
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
      confidence,
      analysis: draftTrusted && evidenceFullyAccepted ? recognition?.analysis ?? null : null,
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
