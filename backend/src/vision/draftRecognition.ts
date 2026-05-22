import { analyzeDraft } from "../engines/draftEngine.js";
import { eventBus } from "../event-bus/eventBus.js";

type RecognizedSlot = {
  heroId?: number;
  heroName?: string;
  confidence?: number;
  variant?: "normal" | "mirror-x";
  source?: "draft-grid" | "draft-slot" | "loading-card" | "manual";
};

type RecognizedDraft = {
  phase?: "ban" | "pick" | "finalize" | "loading";
  allyPicks?: Array<RecognizedSlot | number | string | null>;
  enemyPicks?: Array<RecognizedSlot | number | string | null>;
  allyBans?: Array<RecognizedSlot | number | string | null>;
  enemyBans?: Array<RecognizedSlot | number | string | null>;
  selectedHero?: RecognizedSlot | number | string | null;
  selectedRole?: string;
  selectedLane?: string;
  laneOrientation?: string;
  frameId?: string;
  timestamp?: number;
};

let latestDraftRecognition: any = null;

export async function ingestDraftRecognition(input: RecognizedDraft) {
  const state = {
    phase: input.phase ?? "pick",
    allyPicks: compactSlots(input.allyPicks),
    enemyPicks: compactSlots(input.enemyPicks),
    allyBans: compactSlots(input.allyBans),
    enemyBans: compactSlots(input.enemyBans),
    selectedHero: normalizeSlot(input.selectedHero),
    selectedRole: input.selectedRole,
    selectedLane: input.selectedLane,
    laneOrientation: input.laneOrientation,
    frameId: input.frameId,
    timestamp: input.timestamp ?? Date.now()
  };
  const analysis = await analyzeDraft({
    allyPicks: state.allyPicks.map(slotValue),
    enemyPicks: state.enemyPicks.map(slotValue),
    allyBans: state.allyBans.map(slotValue),
    enemyBans: state.enemyBans.map(slotValue),
    selectedRole: state.selectedRole,
    selectedLane: state.selectedLane,
    laneOrientation: state.laneOrientation,
    phase: state.phase
  });
  latestDraftRecognition = { state, analysis, updatedAt: new Date().toISOString() };
  eventBus.emit("draft_recognized", latestDraftRecognition);
  eventBus.emit("draft_updated", analysis);
  return latestDraftRecognition;
}

export function getLatestDraftRecognition() {
  return latestDraftRecognition;
}

function compactSlots(slots: RecognizedDraft["allyPicks"]) {
  return (slots ?? []).map(normalizeSlot).filter(Boolean);
}

function normalizeSlot(slot: RecognizedSlot | number | string | null | undefined): RecognizedSlot | null {
  if (slot == null) return null;
  if (typeof slot === "number") return { heroId: slot, confidence: 1, source: "manual" };
  if (typeof slot === "string") return { heroName: slot, confidence: 1, source: "manual" };
  const heroId = Number(slot.heroId);
  return {
    heroId: Number.isFinite(heroId) ? heroId : undefined,
    heroName: slot.heroName,
    confidence: Number.isFinite(Number(slot.confidence)) ? Number(slot.confidence) : undefined,
    variant: slot.variant === "mirror-x" ? "mirror-x" : "normal",
    source: slot.source
  };
}

function slotValue(slot: RecognizedSlot) {
  return slot.heroId ?? slot.heroName ?? "";
}
