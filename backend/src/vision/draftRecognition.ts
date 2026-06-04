import { analyzeDraft } from "../engines/draftEngine.js";
import { eventBus } from "../event-bus/eventBus.js";
import { appendAgentDebugLog } from "../services/agentDebugLog.js";
import {
  clearDraftGroundTruthSession,
  isGroundTruthTrusted,
  resolveDraftFastPath,
  rosterToManualIngest,
} from "../services/draftGroundTruth.js";
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
  /** Offline layout-RE markers (e.g. pick_confirm_visible, enemy_pick_active). */
  draftUiStates?: string[];
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
  userFeedback?: "approved" | "denied" | "corrected";
  groundTruthTrusted?: boolean;
};

let latestDraftRecognition: any = null;

export function resetDraftRecognition() {
  clearDraftGroundTruthSession();
  if (!latestDraftRecognition) return;
  latestDraftRecognition = null;
  eventBus.emit("draft_cleared", null);
}

export async function ingestDraftRecognition(input: RecognizedDraft) {
  const resolved = await resolveDraftFastPath(input);
  if (resolved.action === "block") {
    return latestDraftRecognition;
  }
  const effectiveInput: RecognizedDraft =
    resolved.action === "fast_path"
      ? {
          ...rosterToManualIngest(resolved.state),
          frameId: input.frameId ?? `fastpath:${resolved.profileFingerprint.slice(0, 12)}`,
          timestamp: input.timestamp ?? Date.now(),
          provisional: false,
        }
      : input;
  const groundTruthTrusted = isGroundTruthTrusted(effectiveInput);
  const normalized = {
    phase: effectiveInput.phase ?? "pick",
    allyPicks: compactSlots(effectiveInput.allyPicks),
    enemyPicks: compactSlots(effectiveInput.enemyPicks),
    allyBans: compactSlots(effectiveInput.allyBans),
    enemyBans: compactSlots(effectiveInput.enemyBans),
    allySpells: compactSpells(effectiveInput.allySpells),
    allyLanes: compactLanes(effectiveInput.allyLanes),
    selectedHero: normalizeSlot(effectiveInput.selectedHero),
    selectedRole: effectiveInput.selectedRole,
    selectedLane: normalizeContext(effectiveInput.selectedLane),
    selfSlot: normalizeContext(effectiveInput.selfSlot),
    firstPickSide: normalizeContext(effectiveInput.firstPickSide),
    laneOrientation: effectiveInput.laneOrientation,
    frameId: effectiveInput.frameId,
    timestamp: effectiveInput.timestamp ?? Date.now(),
    diagnostics: effectiveInput.diagnostics,
    provisional: groundTruthTrusted ? false : Boolean(effectiveInput.provisional),
    userFeedback: effectiveInput.userFeedback,
    groundTruthTrusted,
  };
  const state = {
    ...normalized,
    allyPicks: acceptedSlots(normalized.allyPicks, "draft-pick-portrait", groundTruthTrusted),
    enemyPicks: acceptedSlots(normalized.enemyPicks, "draft-pick-portrait", groundTruthTrusted),
    allyBans: acceptedSlots(normalized.allyBans, "draft-ban-icon", groundTruthTrusted),
    enemyBans: acceptedSlots(normalized.enemyBans, "draft-ban-icon", groundTruthTrusted),
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
  await appendAgentDebugLog({
    hypothesisId: "F",
    location: "draftRecognition.ts:ingest",
    message: "Draft roster ingested",
    data: {
      provisional: state.provisional,
      allyBans: state.allyBans.map((s: { slot?: number; heroName?: string }) => `${s.slot}:${s.heroName}`),
      enemyBans: state.enemyBans.map((s: { slot?: number; heroName?: string }) => `${s.slot}:${s.heroName}`),
      allyPicks: state.allyPicks.map((s: { slot?: number; heroName?: string }) => `${s.slot}:${s.heroName}`),
      enemyPicks: state.enemyPicks.map((s: { slot?: number; heroName?: string }) => `${s.slot}:${s.heroName}`),
    },
  });
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

function acceptedSlots(
  slots: RecognizedSlot[],
  expectedSource: "draft-ban-icon" | "draft-pick-portrait",
  groundTruthTrusted: boolean,
) {
  const detected = slots.filter((slot) => isDetectedSlot(slot, expectedSource));
  if (!groundTruthTrusted) return detected;
  const manual = slots.filter(
    (slot) =>
      slot?.source === "manual" &&
      (slot.heroId !== undefined || Boolean(slot.heroName)) &&
      Number(slot.confidence ?? 0) >= DETECTED_FACT_CONFIDENCE,
  );
  const merged = new Map<string, RecognizedSlot>();
  for (const slot of [...manual, ...detected]) {
    const key = `${slot.slot ?? 0}:${slot.heroId ?? slot.heroName ?? ""}`;
    merged.set(key, slot);
  }
  return [...merged.values()].sort((left, right) => Number(left.slot ?? 0) - Number(right.slot ?? 0));
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
