import { analyzeDraft } from "../engines/draftEngine.js";
import { eventBus } from "../event-bus/eventBus.js";
import { DETECTED_FACT_CONFIDENCE, updateMatchDraft } from "../state/matchState.js";

type RecognizedSlot = {
  heroId?: number;
  heroName?: string;
  slot?: number;
  confidence?: number;
  variant?: "normal" | "mirror-x";
  source?: "draft-ban-icon" | "draft-pick-portrait" | "loading-card-portrait" | "manual";
};

type RecognizedContext<T> = {
  value?: T;
  confidence?: number;
  source?: "draft-lane-icon" | "draft-self-highlight" | "draft-first-pick-indicator" | "manual";
};

type RecognizedBattleSpell = {
  spell?: string;
  slot?: number;
  confidence?: number;
  source?: "draft-battle-spell-icon" | "manual";
};

type RecognizedAllyLane = {
  lane?: string;
  slot?: number;
  confidence?: number;
  source?: "draft-lane-icon" | "manual";
};

type RecognizedDraft = {
  phase?: "ban" | "pick" | "finalize" | "loading";
  allyPicks?: Array<RecognizedSlot | number | string | null>;
  enemyPicks?: Array<RecognizedSlot | number | string | null>;
  allyBans?: Array<RecognizedSlot | number | string | null>;
  enemyBans?: Array<RecognizedSlot | number | string | null>;
  allySpells?: RecognizedBattleSpell[];
  allyLanes?: RecognizedAllyLane[];
  selectedHero?: RecognizedSlot | number | string | null;
  selectedRole?: string;
  selectedLane?: RecognizedContext<string> | string;
  selfSlot?: RecognizedContext<number> | number;
  firstPickSide?: RecognizedContext<"ally" | "enemy"> | "ally" | "enemy";
  laneOrientation?: string;
  frameId?: string;
  timestamp?: number;
  diagnostics?: unknown;
  provisional?: boolean;
};

let latestDraftRecognition: any = null;

export async function ingestDraftRecognition(input: RecognizedDraft) {
  const normalized = {
    phase: input.phase ?? "pick",
    allyPicks: compactSlots(input.allyPicks),
    enemyPicks: compactSlots(input.enemyPicks),
    allyBans: compactSlots(input.allyBans),
    enemyBans: compactSlots(input.enemyBans),
    allySpells: compactSpells(input.allySpells),
    allyLanes: compactLanes(input.allyLanes),
    selectedHero: normalizeSlot(input.selectedHero),
    selectedRole: input.selectedRole,
    selectedLane: normalizeContext(input.selectedLane),
    selfSlot: normalizeContext(input.selfSlot),
    firstPickSide: normalizeContext(input.firstPickSide),
    laneOrientation: input.laneOrientation,
    frameId: input.frameId,
    timestamp: input.timestamp ?? Date.now(),
    diagnostics: input.diagnostics,
    provisional: Boolean(input.provisional),
  };
  const state = {
    ...normalized,
    allyPicks: detectedSlots(normalized.allyPicks, "draft-pick-portrait"),
    enemyPicks: detectedSlots(normalized.enemyPicks, "draft-pick-portrait"),
    allyBans: detectedSlots(normalized.allyBans, "draft-ban-icon"),
    enemyBans: detectedSlots(normalized.enemyBans, "draft-ban-icon"),
    allySpells: detectedSpells(normalized.allySpells),
    allyLanes: detectedLanes(normalized.allyLanes),
    selectedHero: null,
    selectedLane: isDetectedContext(normalized.selectedLane, "draft-lane-icon") ? normalized.selectedLane : null,
    selfSlot: isDetectedContext(normalized.selfSlot, "draft-self-highlight") ? normalized.selfSlot : null,
    firstPickSide: isDetectedContext(normalized.firstPickSide, "draft-first-pick-indicator") ? normalized.firstPickSide : null
  };
  if (!state.selectedLane && state.selfSlot) {
    const selfLane = state.allyLanes.find((fact) => fact.slot === state.selfSlot?.value);
    if (selfLane) {
      state.selectedLane = {
        value: selfLane.lane,
        confidence: Math.min(selfLane.confidence, Number(state.selfSlot.confidence ?? 0)),
        source: "draft-lane-icon",
      };
    }
  }
  const hasPickIdentity = [state.allyPicks, state.enemyPicks]
    .some((slots) => slots.length > 0);
  const analysis = hasPickIdentity
    ? await analyzeDraft({
      allyPicks: state.allyPicks.map(slotValue),
      enemyPicks: state.enemyPicks.map(slotValue),
      allyBans: state.allyBans.map(slotValue),
      enemyBans: state.enemyBans.map(slotValue),
      allySpells: state.allySpells,
      allyLanes: state.allyLanes,
      selectedRole: state.selectedRole,
      selectedLane: state.selectedLane?.value,
      selfSlot: state.selfSlot?.value,
      laneOrientation: state.laneOrientation,
      phase: state.phase
    })
    : null;
  latestDraftRecognition = { state, analysis, updatedAt: new Date().toISOString() };
  updateMatchDraft(latestDraftRecognition);
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

function compactSpells(spells: RecognizedBattleSpell[] | undefined) {
  return (spells ?? []).map((fact) => ({
    spell: String(fact.spell ?? "").trim(),
    slot: Number(fact.slot),
    confidence: Number(fact.confidence ?? 0),
    source: fact.source,
  })).filter((fact) => fact.spell && Number.isInteger(fact.slot) && fact.slot >= 1 && fact.slot <= 5);
}

function compactLanes(lanes: RecognizedAllyLane[] | undefined) {
  return (lanes ?? []).map((fact) => ({
    lane: String(fact.lane ?? "").trim().toLowerCase(),
    slot: Number(fact.slot),
    confidence: Number(fact.confidence ?? 0),
    source: fact.source,
  })).filter((fact) => fact.lane && Number.isInteger(fact.slot) && fact.slot >= 1 && fact.slot <= 5);
}

function normalizeSlot(slot: RecognizedSlot | number | string | null | undefined): RecognizedSlot | null {
  if (slot == null) return null;
  if (typeof slot === "number") return { heroId: slot, confidence: 1, source: "manual" };
  if (typeof slot === "string") return { heroName: slot, confidence: 1, source: "manual" };
  const heroId = Number(slot.heroId);
  const position = Number(slot.slot);
  return {
    heroId: Number.isFinite(heroId) ? heroId : undefined,
    heroName: slot.heroName,
    slot: Number.isInteger(position) && position >= 1 && position <= 5 ? position : undefined,
    confidence: Number.isFinite(Number(slot.confidence)) ? Number(slot.confidence) : undefined,
    variant: slot.variant === "mirror-x" ? "mirror-x" : "normal",
    source: slot.source
  };
}

function normalizeContext<T extends string | number>(fact: RecognizedContext<T> | T | null | undefined): RecognizedContext<T> | null {
  if (fact == null) return null;
  if (typeof fact !== "object") return { value: fact, confidence: 1, source: "manual" };
  return {
    value: fact.value,
    confidence: Number.isFinite(Number(fact.confidence)) ? Number(fact.confidence) : undefined,
    source: fact.source
  };
}

function slotValue(slot: RecognizedSlot) {
  return slot.heroId ?? slot.heroName ?? "";
}

function detectedSlots(slots: RecognizedSlot[], expectedSource: "draft-ban-icon" | "draft-pick-portrait") {
  return slots.filter((slot) => isDetectedSlot(slot, expectedSource));
}

function detectedSpells(spells: ReturnType<typeof compactSpells>) {
  return spells.filter((fact) =>
    fact.source === "draft-battle-spell-icon" &&
    fact.confidence >= DETECTED_FACT_CONFIDENCE
  );
}
function isDetectedSlot(slot: RecognizedSlot | null, expectedSource: "draft-ban-icon" | "draft-pick-portrait") {
  return Boolean(
    slot &&
    slot.source === expectedSource &&
    (slot.heroId !== undefined || Boolean(slot.heroName)) &&
    Number(slot.confidence ?? 0) >= DETECTED_FACT_CONFIDENCE,
  );
}

function detectedLanes(lanes: ReturnType<typeof compactLanes>) {
  return lanes.filter((fact) =>
    fact.source === "draft-lane-icon" &&
    fact.confidence >= DETECTED_FACT_CONFIDENCE
  );
}
function isDetectedContext<T>(fact: RecognizedContext<T> | null, source: RecognizedContext<T>["source"]) {
  return Boolean(
    fact &&
    fact.source === source &&
    fact.value !== undefined &&
    Number(fact.confidence ?? 0) >= DETECTED_FACT_CONFIDENCE,
  );
}
