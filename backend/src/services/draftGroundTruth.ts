import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { eventBus } from "../event-bus/eventBus.js";
import { saveAnnotation } from "../vision/cvAnnotation.js";
import type { AnnotationBox } from "../vision/cvAnnotation.js";

const projectRoot = path.resolve(process.cwd(), "..");
const cachePath = path.join(projectRoot, "data", "cache", "draft-ground-truth.json");
const lastFrameCandidates = [
  path.join(projectRoot, "data", "cache", "last-adb-frame.png"),
  path.join(projectRoot, "data", "cache", "last-adb-frame.jpg"),
];

const MAX_APPROVED = 20;
const MAX_DENIED = 50;

type DraftPhase = "ban" | "pick" | "finalize" | "loading";
type ManualSlotFact = {
  heroId: number;
  slot: number;
  confidence: number;
  source: "manual";
  variant: "normal";
};
type ManualContext<T extends string | number> = {
  value: T;
  confidence: number;
  source: "manual";
};

export type DraftRosterInput = {
  phase?: string;
  allyPicks?: unknown;
  enemyPicks?: unknown;
  allyBans?: unknown;
  enemyBans?: unknown;
  selectedLane?: unknown;
  selfSlot?: unknown;
  firstPickSide?: unknown;
  laneOrientation?: string;
  userFeedback?: "approved" | "denied" | "corrected";
};

export type DraftManualIngest = {
  phase?: DraftPhase;
  allyPicks?: ManualSlotFact[];
  enemyPicks?: ManualSlotFact[];
  allyBans?: ManualSlotFact[];
  enemyBans?: ManualSlotFact[];
  selectedLane?: ManualContext<string>;
  selfSlot?: ManualContext<number>;
  firstPickSide?: ManualContext<"ally" | "enemy">;
  laneOrientation?: string;
  userFeedback?: "approved" | "denied" | "corrected";
};

type ApprovedProfile = {
  fingerprint: string;
  state: DraftRosterInput;
  approvedAt: string;
};

type PersistedCache = {
  approved: ApprovedProfile[];
  denied: string[];
};

type SessionState = {
  approvedFingerprint: string | null;
  lastAnnotationId: string | null;
};

type ResolveResult =
  | { action: "continue" }
  | { action: "block" }
  | { action: "fast_path"; state: DraftRosterInput; profileFingerprint: string };

let session: SessionState = {
  approvedFingerprint: null,
  lastAnnotationId: null,
};

let persisted: PersistedCache = { approved: [], denied: [] };
let cacheLoaded = false;

export function rosterFingerprint(input: DraftRosterInput | null | undefined): string {
  if (!input) return "";
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

export function isDraftSessionApproved(): boolean {
  return Boolean(session.approvedFingerprint);
}

export function getSessionApprovedFingerprint(): string | null {
  return session.approvedFingerprint;
}

export async function getDraftFeedbackStatus() {
  await ensureCacheLoaded();
  return {
    approved: Boolean(session.approvedFingerprint),
    fingerprint: session.approvedFingerprint,
    deniedCount: persisted.denied.length,
    deniedFingerprints: persisted.denied.slice(0, 20),
    approvedProfileCount: persisted.approved.length,
    lastAnnotationId: session.lastAnnotationId,
  };
}

export async function approveDraft(state: DraftRosterInput, meta?: { note?: string }) {
  await ensureCacheLoaded();
  const fingerprint = rosterFingerprint(state);
  if (!fingerprint || !hasAnyHero(state)) {
    throw new Error("Approve requires at least one recognized ban or pick.");
  }
  const profile: ApprovedProfile = {
    fingerprint,
    state: { ...state, userFeedback: "approved" },
    approvedAt: new Date().toISOString(),
  };
  persisted.approved = [profile, ...persisted.approved.filter((entry) => entry.fingerprint !== fingerprint)].slice(0, MAX_APPROVED);
  session.approvedFingerprint = fingerprint;
  await persistCache();
  eventBus.emit("draft_approved", { fingerprint, meta: meta ?? null });
  return { fingerprint, profile };
}

export async function denyDraft(input: {
  cvFingerprint?: string;
  corrected: DraftRosterInput;
  deniedRecognition?: DraftRosterInput;
  yoloBoxes?: AnnotationBox[];
  diagnostics?: unknown;
}) {
  await ensureCacheLoaded();
  const cvFingerprint = input.cvFingerprint ?? rosterFingerprint(input.deniedRecognition ?? input.corrected);
  if (cvFingerprint) {
    persisted.denied = [cvFingerprint, ...persisted.denied.filter((entry) => entry !== cvFingerprint)].slice(0, MAX_DENIED);
  }
  session.approvedFingerprint = null;
  const annotationId = await saveDraftCorrectionSample(input.yoloBoxes ?? [], input.diagnostics);
  if (annotationId) session.lastAnnotationId = annotationId;
  await persistCache();
  eventBus.emit("draft_denied", { cvFingerprint, annotationId: session.lastAnnotationId });
  return {
    cvFingerprint,
    annotationId: session.lastAnnotationId,
    corrected: { ...input.corrected, userFeedback: "corrected" as const },
  };
}

export function clearDraftGroundTruthSession() {
  session = {
    approvedFingerprint: null,
    lastAnnotationId: null,
  };
}

export function __resetDraftGroundTruthForTests() {
  clearDraftGroundTruthSession();
  persisted = { approved: [], denied: [] };
  cacheLoaded = true;
}

export async function resolveDraftFastPath(input: DraftRosterInput): Promise<ResolveResult> {
  await ensureCacheLoaded();
  const incoming = rosterFingerprint(input);
  if (!incoming) return { action: "continue" };

  if (persisted.denied.includes(incoming) && input.userFeedback !== "corrected" && input.userFeedback !== "approved") {
    return { action: "block" };
  }

  if (session.approvedFingerprint && incoming !== session.approvedFingerprint) {
    clearDraftGroundTruthSession();
  }

  const profile = persisted.approved.find((entry) => entry.fingerprint === incoming);
  if (profile && input.userFeedback !== "corrected") {
    session.approvedFingerprint = profile.fingerprint;
    return {
      action: "fast_path",
      state: { ...profile.state, userFeedback: "approved" },
      profileFingerprint: profile.fingerprint,
    };
  }

  return { action: "continue" };
}

export function rosterToManualIngest(state: DraftRosterInput): DraftManualIngest {
  return {
    phase: normalizeDraftPhase(state.phase),
    allyPicks: slotRowToFacts(state.allyPicks, "draft-pick-portrait"),
    enemyPicks: slotRowToFacts(state.enemyPicks, "draft-pick-portrait"),
    allyBans: slotRowToFacts(state.allyBans, "draft-ban-icon"),
    enemyBans: slotRowToFacts(state.enemyBans, "draft-ban-icon"),
    selectedLane: normalizeLaneContext(state.selectedLane),
    selfSlot: normalizeNumericContext(state.selfSlot),
    firstPickSide: normalizeSideContext(state.firstPickSide),
    laneOrientation: state.laneOrientation,
    userFeedback: state.userFeedback,
  };
}

export function isGroundTruthTrusted(input: DraftRosterInput): boolean {
  return input.userFeedback === "approved" || input.userFeedback === "corrected";
}

function normalizeDraftPhase(value: unknown): DraftPhase {
  return value === "ban" || value === "pick" || value === "finalize" || value === "loading"
    ? value
    : "pick";
}

function slotRowFingerprint(slots: unknown): Array<number | null> {
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

function slotRowToFacts(slots: unknown, _cvSource: "draft-ban-icon" | "draft-pick-portrait"): ManualSlotFact[] {
  const row = slotRowFingerprint(slots);
  return row.flatMap((heroId, index) =>
    heroId == null
      ? []
      : [{ heroId, slot: index + 1, confidence: 1, source: "manual", variant: "normal" }],
  );
}

function contextFingerprint(value: unknown): string | number | null {
  if (value == null) return null;
  if (typeof value !== "object") return String(value);
  const record = value as { value?: unknown };
  return record.value == null ? null : String(record.value);
}

function normalizeLaneContext(value: unknown): ManualContext<string> | undefined {
  const lane = contextFingerprint(value);
  return lane == null ? undefined : { value: String(lane), confidence: 1, source: "manual" as const };
}

function normalizeNumericContext(value: unknown): ManualContext<number> | undefined {
  const slot = Number(contextFingerprint(value));
  return Number.isInteger(slot) && slot >= 1 && slot <= 5
    ? { value: slot, confidence: 1, source: "manual" as const }
    : undefined;
}

function normalizeSideContext(value: unknown): ManualContext<"ally" | "enemy"> | undefined {
  const side = contextFingerprint(value);
  if (side !== "ally" && side !== "enemy") return undefined;
  return { value: side, confidence: 1, source: "manual" as const };
}

function hasAnyHero(state: DraftRosterInput) {
  return [state.allyPicks, state.enemyPicks, state.allyBans, state.enemyBans]
    .some((group) => slotRowFingerprint(group).some((id) => id != null));
}

async function saveDraftCorrectionSample(boxes: AnnotationBox[], diagnostics?: unknown) {
  const frame = await readLastDraftFrame();
  if (!frame) return null;
  try {
    const metadata = await saveAnnotation(frame, {
      split: "train",
      source: "draft-room-deny",
      boxes,
      allowEmpty: boxes.length === 0,
    });
    const metadataPath = path.join(
      projectRoot,
      "data",
      "cv",
      "annotations",
      "metadata",
      metadata.split,
      `${metadata.id}.json`,
    );
    const existing = JSON.parse(await readFile(metadataPath, "utf8")) as Record<string, unknown>;
    await writeFile(
      metadataPath,
      JSON.stringify({ ...existing, draftCorrection: { diagnostics: diagnostics ?? null } }, null, 2) + "\n",
      "utf8",
    );
    return metadata.id;
  } catch {
    return null;
  }
}

async function readLastDraftFrame() {
  for (const candidate of lastFrameCandidates) {
    try {
      await access(candidate);
      return await readFile(candidate);
    } catch {
      continue;
    }
  }
  return null;
}

async function ensureCacheLoaded() {
  if (cacheLoaded) return;
  cacheLoaded = true;
  try {
    const raw = JSON.parse(await readFile(cachePath, "utf8")) as Partial<PersistedCache>;
    persisted = {
      approved: Array.isArray(raw.approved) ? raw.approved.slice(0, MAX_APPROVED) : [],
      denied: Array.isArray(raw.denied) ? raw.denied.slice(0, MAX_DENIED) : [],
    };
  } catch {
    persisted = { approved: [], denied: [] };
  }
}

async function persistCache() {
  await mkdir(path.dirname(cachePath), { recursive: true });
  await writeFile(cachePath, JSON.stringify(persisted, null, 2) + "\n", "utf8");
}
