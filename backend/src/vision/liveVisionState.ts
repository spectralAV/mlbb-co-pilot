import { eventBus } from "../event-bus/eventBus.js";
import { ingestLiveReasoning } from "../engines/liveReasoningEngine.js";
import { updateMatchVision } from "../state/matchState.js";

export type VisionScreenState =
  | "unknown"
  | "draft"
  | "loading"
  | "live_hud"
  | "death_replay"
  | "scoreboard"
  | "item_shop";

export type VisionDirectorScene = "main" | "map" | "text" | "counter" | "picks";

type NormalizedMarker = {
  id: string;
  side: "ally" | "enemy";
  minimap: [number, number];
  confidence: number;
};

type VisionFrameInput = {
  frameId?: string;
  source?: string;
  timestamp?: number;
  screen?: VisionScreenState;
  confidence?: number;
  evidence?: string[];
  regions?: Record<string, { mean?: number; contrast?: number; changed?: number; active?: boolean }>;
  minimapMarkers?: NormalizedMarker[];
  signals?: {
    objectiveSoon?: boolean;
    objectiveName?: string;
    objectiveSpawnsInSec?: number;
    missingEnemyCount?: number;
    missingEnemies?: string[];
    riverVision?: boolean;
    warning?: string;
    teamHasAntiHeal?: boolean;
    enemyHealingThreats?: string[];
    enemyItems?: string[];
  };
};

export type LiveVisionSnapshot = {
  frameId: string;
  source: string;
  timestamp: number;
  screen: VisionScreenState;
  confidence: number;
  evidence: string[];
  regions: Record<string, { mean: number; contrast: number; changed: number; active: boolean }>;
  minimapMarkers: NormalizedMarker[];
  signals: {
    objectiveSoon: boolean;
    objectiveName?: string;
    objectiveSpawnsInSec?: number;
    missingEnemyCount?: number;
    missingEnemies: string[];
    riverVision?: boolean;
    warning?: string;
    teamHasAntiHeal?: boolean;
    enemyHealingThreats: string[];
    enemyItems: string[];
  };
  directorScene: VisionDirectorScene;
  updatedAt: string;
};

let latest: LiveVisionSnapshot | null = null;

export function ingestLiveVisionFrame(input: VisionFrameInput) {
  const snapshot: LiveVisionSnapshot = {
    frameId: String(input.frameId ?? `frame-${Date.now()}`),
    source: String(input.source ?? "capture"),
    timestamp: Number.isFinite(Number(input.timestamp)) ? Number(input.timestamp) : Date.now(),
    screen: normalizeScreen(input.screen),
    confidence: clamp01(input.confidence),
    evidence: Array.isArray(input.evidence) ? input.evidence.map(String).slice(0, 12) : [],
    regions: normalizeRegions(input.regions),
    minimapMarkers: normalizeMarkers(input.minimapMarkers),
    signals: {
      objectiveSoon: Boolean(input.signals?.objectiveSoon),
      objectiveName: input.signals?.objectiveName ? String(input.signals.objectiveName) : undefined,
      objectiveSpawnsInSec: optionalNumber(input.signals?.objectiveSpawnsInSec),
      missingEnemyCount: optionalNumber(input.signals?.missingEnemyCount),
      missingEnemies: normalizeStrings(input.signals?.missingEnemies),
      riverVision: typeof input.signals?.riverVision === "boolean" ? input.signals.riverVision : undefined,
      warning: input.signals?.warning ? String(input.signals.warning) : undefined,
      teamHasAntiHeal: typeof input.signals?.teamHasAntiHeal === "boolean" ? input.signals.teamHasAntiHeal : undefined,
      enemyHealingThreats: normalizeStrings(input.signals?.enemyHealingThreats),
      enemyItems: normalizeStrings(input.signals?.enemyItems)
    },
    directorScene: "main",
    updatedAt: new Date().toISOString()
  };
  const reasoning = ingestLiveReasoning(snapshot);
  snapshot.directorScene = reasoning.scene;
  latest = snapshot;
  updateMatchVision(snapshot, reasoning);
  eventBus.emit("vision_updated", snapshot);
  return snapshot;
}

export function getLatestLiveVision() {
  return latest;
}

function normalizeScreen(value?: VisionScreenState): VisionScreenState {
  return ["unknown", "draft", "loading", "live_hud", "death_replay", "scoreboard", "item_shop"].includes(String(value))
    ? value as VisionScreenState
    : "unknown";
}

function normalizeMarkers(markers?: NormalizedMarker[]) {
  if (!Array.isArray(markers)) return [];
  return markers.slice(0, 20).map((marker, index) => ({
    id: String(marker.id ?? `${marker.side ?? "marker"}-${index}`),
    side: marker.side === "enemy" ? "enemy" as const : "ally" as const,
    minimap: [clamp01(marker.minimap?.[0]), clamp01(marker.minimap?.[1])] as [number, number],
    confidence: clamp01(marker.confidence)
  }));
}

function normalizeRegions(regions?: VisionFrameInput["regions"]) {
  const normalized: LiveVisionSnapshot["regions"] = {};
  if (!regions) return normalized;
  for (const [key, value] of Object.entries(regions)) {
    normalized[key] = {
      mean: finiteOrZero(value.mean),
      contrast: finiteOrZero(value.contrast),
      changed: finiteOrZero(value.changed),
      active: Boolean(value.active)
    };
  }
  return normalized;
}

function optionalNumber(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function normalizeStrings(value: unknown) {
  return Array.isArray(value) ? value.map(String).map((item) => item.trim()).filter(Boolean).slice(0, 10) : [];
}

function finiteOrZero(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function clamp01(value: unknown) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.min(1, number));
}
