import { eventBus } from "../event-bus/eventBus.js";
import { ingestLiveReasoning } from "../engines/liveReasoningEngine.js";
import { DETECTED_FACT_CONFIDENCE, getMatchState, resetMatchState, updateMatchVision } from "../state/matchState.js";
import { resetDraftRecognition } from "./draftRecognition.js";
import { updateMinimapMonitor, type MinimapMonitorSnapshot } from "./minimapMonitor.js";
import type { ScreenTextFact } from "./screenTextRecognition.js";
import { timerClasses, type TimerFact } from "./timerRecognition.js";
import { recordVisionReflection } from "./visionReflection.js";
import { z } from "zod";

export type VisionScreenState =
  | "unknown"
  | "lobby"
  | "draft"
  | "loading"
  | "live_hud"
  | "death_replay"
  | "scoreboard"
  | "item_shop";

export type VisionDirectorScene = "main" | "map" | "text" | "counter" | "picks";

const visionScreenStates: readonly VisionScreenState[] = ["unknown", "lobby", "draft", "loading", "live_hud", "death_replay", "scoreboard", "item_shop"];
const liveVisionFrameEnvelopeSchema = z.object({
  frameId: z.unknown().optional(),
  source: z.unknown().optional(),
  timestamp: z.unknown().optional(),
  screen: z.unknown().optional(),
  confidence: z.unknown().optional(),
  evidence: z.unknown().optional(),
  layoutProfile: z.unknown().optional(),
  anchors: z.unknown().optional(),
  regions: z.unknown().optional(),
  minimapMarkers: z.unknown().optional(),
  signals: z.unknown().optional(),
}).passthrough();

type NormalizedMarker = {
  id: string;
  side: "ally" | "enemy";
  markerClass: "team-color-candidate" | "ultralytics-yolo";
  minimap: [number, number];
  confidence: number;
  heroId?: number;
  heroName?: string;
  heroIcon?: string;
  identityConfidence?: number;
  identitySource?: "minimap-hero-identity";
};

type ModelDetectionFact = {
  classId: number;
  className: string;
  confidence: number;
  bbox: [number, number, number, number];
  center: [number, number];
  source: "ultralytics-yolo";
  trackId?: string;
  trackAge?: number;
  trackMissingFrames?: number;
};

type MapObjectFact = {
  objectType: "turtle" | "lord" | "ally_turret" | "enemy_turret";
  minimap: [number, number];
  confidence: number;
  source: "ultralytics-yolo";
};

type EquipmentFact = {
  itemId: number;
  itemName: string;
  side: "ally" | "enemy";
  row: number;
  slot: number;
  confidence: number;
  source: "equipment-item-icon";
};

type LayoutProfileFact = {
  id: string;
  label: string;
  aspectRatio: number;
  sourceWidth: number;
  sourceHeight: number;
  confidence: number;
};

type UiAnchorFact = {
  key: string;
  label: string;
  rect: [number, number, number, number];
  confidence: number;
  active: boolean;
};

type VisionFrameInput = {
  frameId?: string;
  source?: string;
  timestamp?: number;
  screen?: VisionScreenState;
  confidence?: number;
  evidence?: string[];
  layoutProfile?: LayoutProfileFact;
  anchors?: UiAnchorFact[];
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
    enemyEquipment?: EquipmentFact[];
    allyItems?: string[];
    allyEquipment?: EquipmentFact[];
    yoloDetections?: ModelDetectionFact[];
    minimapObjects?: MapObjectFact[];
    timerFacts?: TimerFact[];
    screenTextFacts?: ScreenTextFact[];
  };
};

export type LiveVisionSnapshot = {
  frameId: string;
  source: string;
  timestamp: number;
  screen: VisionScreenState;
  confidence: number;
  evidence: string[];
  layoutProfile?: LayoutProfileFact;
  anchors: UiAnchorFact[];
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
    enemyEquipment: EquipmentFact[];
    allyItems: string[];
    allyEquipment: EquipmentFact[];
    yoloDetections: ModelDetectionFact[];
    minimapObjects: MapObjectFact[];
    mapMonitor: MinimapMonitorSnapshot;
    timerFacts: TimerFact[];
    screenTextFacts: ScreenTextFact[];
  };
  directorScene: VisionDirectorScene;
  updatedAt: string;
};

export type LiveVisionObservationSummary = {
  available: boolean;
  connected: boolean;
  stale: boolean;
  timestamp: number | null;
  ageMs: number | null;
  source: string | null;
  screen: VisionScreenState;
  confidence: "low" | "medium" | "high";
  numericConfidence: number;
  minimap: {
    recognized: boolean;
    markerCount: number;
    visibleAllies: number;
    visibleEnemies: number;
    lastSeenEnemies: number;
    objectCount: number;
    visibleObjectives: Array<"turtle" | "lord">;
  };
  objectiveTimers: {
    recognized: boolean;
    timerTypes: string[];
  };
  detections: {
    yolo: number;
    equipment: {
      ally: number;
      enemy: number;
    };
    screenText: number;
  };
  warning?: string;
  updatedAt: string | null;
};

const staleObservationMs = 5000;
let latest: LiveVisionSnapshot | null = null;
let rememberedEnemyItems: string[] = [];
let rememberedEnemyEquipment: EquipmentFact[] = [];
let rememberedAllyItems: string[] = [];
let rememberedAllyEquipment: EquipmentFact[] = [];

export function parseLiveVisionFrameInput(payload: unknown): VisionFrameInput {
  const parsed = liveVisionFrameEnvelopeSchema.safeParse(payload);
  if (!parsed.success) throw new Error("Live vision frame must be a JSON object.");
  const input = parsed.data;
  const signals = parseInputSignals(input.signals);
  return {
    frameId: optionalString(input.frameId),
    source: optionalString(input.source),
    timestamp: optionalNumber(input.timestamp),
    screen: normalizeScreen(input.screen),
    confidence: optionalNumber(input.confidence),
    evidence: normalizeStrings(input.evidence),
    layoutProfile: parseLayoutProfile(input.layoutProfile),
    anchors: parseUiAnchors(input.anchors),
    regions: parseInputRegions(input.regions),
    minimapMarkers: parseInputMarkers(input.minimapMarkers),
    ...(signals ? { signals } : {}),
  };
}

function resetMatchLifecycleState(_reason: string, _fromScreen: string, _toScreen: string) {
  resetDraftRecognition();
  resetMatchState();
}

const postMatchScreens: readonly VisionScreenState[] = ["scoreboard", "item_shop", "death_replay", "live_hud", "draft", "loading"];
const newDraftSessionScreens: readonly VisionScreenState[] = ["scoreboard", "item_shop", "death_replay", "lobby", "unknown"];

export function ingestLiveVisionFrame(input: VisionFrameInput) {
  const screen = normalizeScreen(input.screen);
  const prevScreen = latest?.screen ?? "unknown";
  if (screen === "lobby" && prevScreen !== "lobby" && postMatchScreens.includes(prevScreen as VisionScreenState)) {
    resetMatchLifecycleState("returned_to_lobby", prevScreen, screen);
  } else if (screen === "draft" && prevScreen !== "draft" && newDraftSessionScreens.includes(prevScreen as VisionScreenState)) {
    resetMatchLifecycleState("new_draft_session", prevScreen, screen);
  }
  const detectedEnemyEquipment = normalizeEquipmentFacts(input.signals?.enemyEquipment, "enemy");
  const detectedAllyEquipment = normalizeEquipmentFacts(input.signals?.allyEquipment, "ally");
  const detectedEnemyItems = normalizeStrings(input.signals?.enemyItems);
  if (screen === "lobby" || screen === "draft" || screen === "loading") {
    rememberedEnemyItems = [];
    rememberedEnemyEquipment = [];
    rememberedAllyItems = [];
    rememberedAllyEquipment = [];
  } else if (screen === "scoreboard" && detectedEnemyEquipment.length) {
    rememberedEnemyEquipment = detectedEnemyEquipment;
    rememberedEnemyItems = [...new Set(detectedEnemyEquipment.map((item) => item.itemName))];
  } else if (screen === "scoreboard" && detectedEnemyItems.length) {
    rememberedEnemyItems = detectedEnemyItems;
  }
  if (screen === "scoreboard" && detectedAllyEquipment.length) {
    rememberedAllyEquipment = detectedAllyEquipment;
    rememberedAllyItems = [...new Set(detectedAllyEquipment.map((item) => item.itemName))];
  }
  const allyItems = detectedAllyEquipment.length
    ? [...new Set(detectedAllyEquipment.map((item) => item.itemName))]
    : rememberedAllyItems;
  const minimapMarkers = normalizeMarkers(input.minimapMarkers);
  const minimapObjects = normalizeMapObjects(input.signals?.minimapObjects);
  const mapMonitor = updateMinimapMonitor({
    screen,
    timestamp: Number.isFinite(Number(input.timestamp)) ? Number(input.timestamp) : Date.now(),
    markers: minimapMarkers,
    objects: minimapObjects,
  });
  const snapshot: LiveVisionSnapshot = {
    frameId: String(input.frameId ?? `frame-${Date.now()}`),
    source: String(input.source ?? "capture"),
    timestamp: Number.isFinite(Number(input.timestamp)) ? Number(input.timestamp) : Date.now(),
    screen,
    confidence: clamp01(input.confidence),
    evidence: Array.isArray(input.evidence) ? input.evidence.map(String).slice(0, 12) : [],
    layoutProfile: input.layoutProfile,
    anchors: normalizeUiAnchors(input.anchors),
    regions: normalizeRegions(input.regions),
    minimapMarkers,
    signals: {
      objectiveSoon: Boolean(input.signals?.objectiveSoon),
      objectiveName: input.signals?.objectiveName ? String(input.signals.objectiveName) : undefined,
      objectiveSpawnsInSec: optionalNumber(input.signals?.objectiveSpawnsInSec),
      missingEnemyCount: optionalNumber(input.signals?.missingEnemyCount),
      missingEnemies: normalizeStrings(input.signals?.missingEnemies),
      riverVision: typeof input.signals?.riverVision === "boolean" ? input.signals.riverVision : undefined,
      warning: input.signals?.warning ? String(input.signals.warning) : undefined,
      teamHasAntiHeal: typeof input.signals?.teamHasAntiHeal === "boolean"
        ? input.signals.teamHasAntiHeal
        : allyItems.some(isAntiHealItem),
      enemyHealingThreats: normalizeStrings(input.signals?.enemyHealingThreats),
      enemyItems: detectedEnemyEquipment.length
        ? [...new Set(detectedEnemyEquipment.map((item) => item.itemName))]
        : detectedEnemyItems.length ? detectedEnemyItems : rememberedEnemyItems,
      enemyEquipment: detectedEnemyEquipment.length ? detectedEnemyEquipment : rememberedEnemyEquipment,
      allyItems,
      allyEquipment: detectedAllyEquipment.length ? detectedAllyEquipment : rememberedAllyEquipment,
      yoloDetections: normalizeModelDetections(input.signals?.yoloDetections),
      minimapObjects,
      mapMonitor,
      timerFacts: normalizeTimerFacts(input.signals?.timerFacts),
      screenTextFacts: normalizeScreenTextFacts(input.signals?.screenTextFacts),
    },
    directorScene: "main",
    updatedAt: new Date().toISOString()
  };
  const reasoning = ingestLiveReasoning(snapshot);
  snapshot.directorScene = reasoning.scene;
  latest = snapshot;
  updateMatchVision(snapshot, reasoning);
  eventBus.emit("vision_updated", snapshot);
  reflectLiveVisionSnapshot(snapshot);
  return snapshot;
}

export function getLatestLiveVision() {
  return latest;
}

export function getLatestLiveVisionObservation(now = Date.now()): LiveVisionObservationSummary {
  if (!latest) return emptyObservationSummary();
  const ageMs = Math.max(0, now - latest.timestamp);
  const stale = ageMs > staleObservationMs;
  const timerTypes = latest.signals.timerFacts
    .filter((fact) => ["turtle_respawn_timer", "lord_respawn_timer", "minimap_objective_timer"].includes(fact.timerType))
    .map((fact) => fact.timerType);
  const markerCount = latest.minimapMarkers.length;
  const monitor = latest.signals.mapMonitor;
  const minimapRecognized = latest.screen === "live_hud" &&
    latest.confidence >= DETECTED_FACT_CONFIDENCE &&
    (markerCount > 0 || monitor.visibleAllies > 0 || monitor.visibleEnemies > 0 || latest.regions.minimap !== undefined);
  return {
    available: true,
    connected: !stale,
    stale,
    timestamp: latest.timestamp,
    ageMs,
    source: latest.source,
    screen: latest.screen,
    confidence: confidenceLabel(latest.confidence, stale),
    numericConfidence: latest.confidence,
    minimap: {
      recognized: minimapRecognized,
      markerCount,
      visibleAllies: monitor.visibleAllies,
      visibleEnemies: monitor.visibleEnemies,
      lastSeenEnemies: monitor.lastSeenEnemies,
      objectCount: monitor.objects.length,
      visibleObjectives: monitor.visibleObjectives,
    },
    objectiveTimers: {
      recognized: timerTypes.length > 0,
      timerTypes,
    },
    detections: {
      yolo: latest.signals.yoloDetections.length,
      equipment: {
        ally: latest.signals.allyEquipment.length,
        enemy: latest.signals.enemyEquipment.length,
      },
      screenText: latest.signals.screenTextFacts.length,
    },
    warning: stale
      ? "CV observation stale"
      : latest.screen === "live_hud" && !minimapRecognized
        ? "Minimap not confidently recognized"
        : latest.signals.warning,
    updatedAt: latest.updatedAt,
  };
}

function emptyObservationSummary(): LiveVisionObservationSummary {
  return {
    available: false,
    connected: false,
    stale: true,
    timestamp: null,
    ageMs: null,
    source: null,
    screen: "unknown",
    confidence: "low",
    numericConfidence: 0,
    minimap: {
      recognized: false,
      markerCount: 0,
      visibleAllies: 0,
      visibleEnemies: 0,
      lastSeenEnemies: 0,
      objectCount: 0,
      visibleObjectives: [],
    },
    objectiveTimers: {
      recognized: false,
      timerTypes: [],
    },
    detections: {
      yolo: 0,
      equipment: { ally: 0, enemy: 0 },
      screenText: 0,
    },
    warning: "CV disconnected",
    updatedAt: null,
  };
}

function parseLayoutProfile(value: unknown): LayoutProfileFact | undefined {
  const record = asRecord(value);
  if (!record) return undefined;
  const id = optionalString(record.id);
  const label = optionalString(record.label);
  const aspectRatio = optionalNumber(record.aspectRatio);
  const sourceWidth = optionalNumber(record.sourceWidth);
  const sourceHeight = optionalNumber(record.sourceHeight);
  const confidence = optionalNumber(record.confidence);
  if (!id || !label || aspectRatio === undefined || sourceWidth === undefined || sourceHeight === undefined || confidence === undefined) {
    return undefined;
  }
  return {
    id,
    label,
    aspectRatio,
    sourceWidth,
    sourceHeight,
    confidence: clamp01(confidence),
  };
}

function parseUiAnchors(value: unknown): UiAnchorFact[] | undefined {
  const anchors = normalizeUiAnchors(recordArray(value)
    .map((anchor) => {
      const rect = normalizeNormalizedRect(anchor.rect);
      const key = optionalString(anchor.key);
      const label = optionalString(anchor.label);
      if (!key || !label || !rect) return null;
      return {
        key,
        label,
        rect,
        confidence: clamp01(anchor.confidence),
        active: Boolean(anchor.active),
      };
    })
    .filter((anchor): anchor is UiAnchorFact => Boolean(anchor)));
  return anchors.length ? anchors : undefined;
}

function normalizeUiAnchors(value: unknown): UiAnchorFact[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((anchor): anchor is UiAnchorFact => Boolean(anchor && typeof anchor === "object"))
    .map((anchor) => ({
      key: String(anchor.key ?? "").trim(),
      label: String(anchor.label ?? "").trim(),
      rect: normalizeNormalizedRect(anchor.rect) ?? [0, 0, 0, 0],
      confidence: clamp01(anchor.confidence),
      active: Boolean(anchor.active),
    }))
    .filter((anchor) => anchor.key && anchor.label && anchor.rect[2] > 0 && anchor.rect[3] > 0)
    .slice(0, 12);
}

function normalizeNormalizedRect(value: unknown): [number, number, number, number] | null {
  if (!Array.isArray(value) || value.length !== 4) return null;
  const rect = value.map(Number);
  return rect.every((coordinate) => Number.isFinite(coordinate) && coordinate >= 0 && coordinate <= 1) && rect[2] > 0 && rect[3] > 0
    ? rect as [number, number, number, number]
    : null;
}

function parseInputRegions(value: unknown): VisionFrameInput["regions"] | undefined {
  const record = asRecord(value);
  if (!record) return undefined;
  const regions: VisionFrameInput["regions"] = {};
  for (const [key, rawMetrics] of Object.entries(record)) {
    const metrics = asRecord(rawMetrics);
    if (!metrics) continue;
    regions[key] = {
      mean: optionalNumber(metrics.mean),
      contrast: optionalNumber(metrics.contrast),
      changed: optionalNumber(metrics.changed),
      active: typeof metrics.active === "boolean" ? metrics.active : undefined,
    };
  }
  return Object.keys(regions).length ? regions : undefined;
}

function parseInputMarkers(value: unknown): NormalizedMarker[] | undefined {
  const markers = recordArray(value)
    .map((marker, index) => {
      const side = marker.side === "enemy" || marker.side === "ally" ? marker.side : null;
      const minimap = normalizePoint(marker.minimap);
      const confidence = optionalNumber(marker.confidence);
      if (!side || !minimap || confidence === undefined) return null;
      const heroName = optionalString(marker.heroName);
      const heroId = optionalNumber(marker.heroId);
      const heroIcon = optionalString(marker.heroIcon);
      const identityConfidence = optionalNumber(marker.identityConfidence);
      return {
        id: optionalString(marker.id) ?? `${side}-${index}`,
        side,
        markerClass: marker.markerClass === "ultralytics-yolo" ? "ultralytics-yolo" as const : "team-color-candidate" as const,
        minimap,
        confidence,
        ...(Number.isFinite(heroId) ? { heroId } : {}),
        ...(heroName ? { heroName } : {}),
        ...(heroIcon ? { heroIcon } : {}),
        ...(identityConfidence !== undefined ? { identityConfidence } : {}),
        ...(marker.identitySource === "minimap-hero-identity" ? { identitySource: "minimap-hero-identity" as const } : {}),
      };
    })
    .filter((marker): marker is NormalizedMarker => Boolean(marker))
    .slice(0, 20);
  return markers.length ? markers : undefined;
}

function parseInputSignals(value: unknown): VisionFrameInput["signals"] | undefined {
  const record = asRecord(value);
  if (!record) return undefined;
  const signals: NonNullable<VisionFrameInput["signals"]> = {};
  if (typeof record.objectiveSoon === "boolean") signals.objectiveSoon = record.objectiveSoon;
  signals.objectiveName = optionalString(record.objectiveName);
  signals.objectiveSpawnsInSec = optionalNumber(record.objectiveSpawnsInSec);
  signals.missingEnemyCount = optionalNumber(record.missingEnemyCount);
  signals.missingEnemies = normalizeStrings(record.missingEnemies);
  if (typeof record.riverVision === "boolean") signals.riverVision = record.riverVision;
  signals.warning = optionalString(record.warning);
  if (typeof record.teamHasAntiHeal === "boolean") signals.teamHasAntiHeal = record.teamHasAntiHeal;
  signals.enemyHealingThreats = normalizeStrings(record.enemyHealingThreats);
  signals.enemyItems = normalizeStrings(record.enemyItems);
  signals.allyItems = normalizeStrings(record.allyItems);
  signals.enemyEquipment = parseInputEquipmentFacts(record.enemyEquipment, "enemy");
  signals.allyEquipment = parseInputEquipmentFacts(record.allyEquipment, "ally");
  signals.yoloDetections = parseInputModelDetections(record.yoloDetections);
  signals.minimapObjects = parseInputMapObjects(record.minimapObjects);
  signals.timerFacts = parseInputTimerFacts(record.timerFacts);
  signals.screenTextFacts = parseInputScreenTextFacts(record.screenTextFacts);

  for (const key of Object.keys(signals) as Array<keyof typeof signals>) {
    const entry = signals[key];
    if (Array.isArray(entry) && !entry.length) delete signals[key];
    else if (entry === undefined) delete signals[key];
  }
  return Object.keys(signals).length ? signals : undefined;
}

function parseInputEquipmentFacts(value: unknown, side: "ally" | "enemy"): EquipmentFact[] {
  return recordArray(value)
    .map((fact) => ({
      itemId: Number(fact.itemId),
      itemName: String(fact.itemName ?? "").trim(),
      side,
      row: Number(fact.row),
      slot: Number(fact.slot),
      confidence: Number(fact.confidence),
      source: "equipment-item-icon" as const,
    }))
    .filter((fact) => Number.isFinite(fact.itemId) && Boolean(fact.itemName) && Number.isFinite(fact.confidence))
    .slice(0, 30);
}

function parseInputModelDetections(value: unknown): ModelDetectionFact[] {
  return recordArray(value)
    .map((fact) => {
      const bbox = normalizeBox(fact.bbox);
      const center = normalizePoint(fact.center);
      const trackId = optionalString(fact.trackId);
      if (!bbox || !center) return null;
      const detection: ModelDetectionFact = {
        classId: Number(fact.classId),
        className: String(fact.className ?? "").trim(),
        confidence: Number(fact.confidence),
        bbox,
        center,
        source: "ultralytics-yolo" as const,
      };
      const trackAge = optionalNumber(fact.trackAge);
      const trackMissingFrames = optionalNumber(fact.trackMissingFrames);
      if (trackId) detection.trackId = trackId;
      if (trackAge !== undefined) detection.trackAge = trackAge;
      if (trackMissingFrames !== undefined) detection.trackMissingFrames = trackMissingFrames;
      return detection;
    })
    .filter((fact): fact is ModelDetectionFact => Boolean(fact && Number.isInteger(fact.classId) && fact.className && Number.isFinite(fact.confidence)))
    .slice(0, 64);
}

function parseInputMapObjects(value: unknown): MapObjectFact[] {
  return recordArray(value)
    .map((fact) => {
      const objectType = String(fact.objectType ?? "");
      const minimap = normalizePoint(fact.minimap);
      if (!["turtle", "lord", "ally_turret", "enemy_turret"].includes(objectType) || !minimap) return null;
      return {
        objectType: objectType as MapObjectFact["objectType"],
        minimap,
        confidence: Number(fact.confidence),
        source: "ultralytics-yolo" as const,
      };
    })
    .filter((fact): fact is MapObjectFact => Boolean(fact && Number.isFinite(fact.confidence)))
    .slice(0, 24);
}

function parseInputTimerFacts(value: unknown): TimerFact[] {
  return recordArray(value)
    .map((fact) => {
      const timerType = String(fact.timerType ?? "");
      if (!timerClasses.includes(timerType as TimerFact["timerType"]) || fact.source !== "timer-ocr") return null;
      const timerFact: TimerFact = {
        timerType: timerType as TimerFact["timerType"],
        text: String(fact.text ?? ""),
        confidence: Number(fact.confidence),
        source: "timer-ocr" as const,
        confirmedAt: Number(fact.confirmedAt),
      };
      const seconds = optionalNumber(fact.seconds);
      const value = optionalNumber(fact.value);
      const kills = optionalNumber(fact.kills);
      const deaths = optionalNumber(fact.deaths);
      const assists = optionalNumber(fact.assists);
      if (seconds !== undefined) timerFact.seconds = seconds;
      if (value !== undefined) timerFact.value = value;
      if (kills !== undefined) timerFact.kills = kills;
      if (deaths !== undefined) timerFact.deaths = deaths;
      if (assists !== undefined) timerFact.assists = assists;
      return timerFact;
    })
    .filter((fact): fact is TimerFact => Boolean(fact && Number.isFinite(fact.confidence) && Number.isFinite(fact.confirmedAt)))
    .slice(0, 8);
}

function parseInputScreenTextFacts(value: unknown): ScreenTextFact[] {
  return recordArray(value)
    .map((fact) => {
      const rect = normalizeBox(fact.rect);
      if (!rect || fact.source !== "paddleocr-screen") return null;
      const screenTextFact: ScreenTextFact = {
        region: String(fact.region ?? "").trim(),
        text: String(fact.text ?? "").replace(/\s+/g, " ").trim(),
        confidence: Number(fact.confidence),
        rect,
        words: recordArray(fact.words)
          .map((word) => {
            const candidate: ScreenTextFact["words"][number] = {
              text: String(word.text ?? "").replace(/\s+/g, " ").trim(),
              confidence: Number(word.confidence),
            };
            if (word.bbox !== undefined) candidate.bbox = word.bbox;
            return candidate;
          })
          .filter((word) => word.text && Number.isFinite(word.confidence))
          .slice(0, 16),
        source: "paddleocr-screen" as const,
        observedAt: Number(fact.observedAt),
      };
      return screenTextFact;
    })
    .filter((fact): fact is ScreenTextFact => Boolean(fact && fact.region && fact.text && Number.isFinite(fact.confidence) && Number.isFinite(fact.observedAt)))
    .slice(0, 8);
}

function normalizeScreen(value?: unknown): VisionScreenState {
  return visionScreenStates.includes(String(value) as VisionScreenState)
    ? value as VisionScreenState
    : "unknown";
}

function normalizeMarkers(markers?: NormalizedMarker[]) {
  if (!Array.isArray(markers)) return [];
  const draft = getMatchState().draft;
  return markers.slice(0, 20).map((marker, index) => {
    const side = marker.side === "enemy" ? "enemy" as const : "ally" as const;
    const normalized = {
      id: String(marker.id ?? `${side}-${index}`),
      side,
      markerClass: marker.markerClass === "ultralytics-yolo" ? "ultralytics-yolo" as const : "team-color-candidate" as const,
      minimap: [clamp01(marker.minimap?.[0]), clamp01(marker.minimap?.[1])] as [number, number],
      confidence: clamp01(marker.confidence),
    };
    const roster = side === "enemy" ? draft?.enemyPicks : draft?.allyPicks;
    const identity = acceptMarkerIdentity(marker, roster);
    return identity ? { ...normalized, ...identity } : normalized;
  });
}

function acceptMarkerIdentity(marker: NormalizedMarker, roster?: Array<{ heroId?: number; heroName?: string }>) {
  const identityConfidence = clamp01(marker.identityConfidence);
  if (marker.identitySource !== "minimap-hero-identity" || identityConfidence < DETECTED_FACT_CONFIDENCE || !roster?.length) {
    return null;
  }
  const heroId = Number(marker.heroId);
  const heroName = String(marker.heroName ?? "").trim().toLowerCase();
  const match = roster.find((hero) =>
    (Number.isFinite(heroId) && hero.heroId === heroId) ||
    (Boolean(heroName) && String(hero.heroName ?? "").trim().toLowerCase() === heroName)
  );
  if (!match || (!match.heroId && !match.heroName)) return null;
  return {
    heroId: match.heroId,
    heroName: match.heroName,
    heroIcon: match.heroId ? `/api/vision/heroes/icon/${match.heroId}` : undefined,
    identityConfidence,
    identitySource: "minimap-hero-identity" as const,
  };
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

function optionalString(value: unknown) {
  const text = String(value ?? "").trim();
  return text ? text : undefined;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function recordArray(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => Boolean(asRecord(item))) : [];
}

function normalizeStrings(value: unknown) {
  return Array.isArray(value) ? value.map(String).map((item) => item.trim()).filter(Boolean).slice(0, 10) : [];
}

function normalizeEquipmentFacts(value: unknown, side: "ally" | "enemy"): EquipmentFact[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((value) => {
      const fact = asRecord(value);
      return {
        itemId: Number(fact?.itemId),
        itemName: String(fact?.itemName ?? "").trim(),
        side,
        row: Number(fact?.row),
        slot: Number(fact?.slot),
        confidence: clamp01(fact?.confidence),
        source: "equipment-item-icon" as const,
      };
    })
    .filter((fact) =>
      Number.isFinite(fact.itemId) &&
      Boolean(fact.itemName) &&
      Number.isInteger(fact.row) && fact.row >= 1 && fact.row <= 5 &&
      Number.isInteger(fact.slot) && fact.slot >= 1 && fact.slot <= 6 &&
      fact.confidence >= DETECTED_FACT_CONFIDENCE)
    .slice(0, 30);
}

function normalizeModelDetections(value: unknown): ModelDetectionFact[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((value) => {
      const fact = asRecord(value);
      const trackId = String(fact?.trackId ?? "").trim();
      return {
        classId: Number(fact?.classId),
        className: String(fact?.className ?? "").trim(),
        confidence: clamp01(fact?.confidence),
        bbox: normalizeBox(fact?.bbox),
        center: normalizePoint(fact?.center),
        source: "ultralytics-yolo" as const,
        ...(trackId ? { trackId } : {}),
        trackAge: optionalNumber(fact?.trackAge),
        trackMissingFrames: optionalNumber(fact?.trackMissingFrames),
      };
    })
    .filter((fact) =>
      Number.isInteger(fact.classId) &&
      Boolean(fact.className) &&
      fact.bbox !== null &&
      fact.center !== null &&
      fact.confidence >= DETECTED_FACT_CONFIDENCE)
    .map((fact) => ({ ...fact, bbox: fact.bbox!, center: fact.center! }))
    .slice(0, 64);
}

function reflectLiveVisionSnapshot(snapshot: LiveVisionSnapshot) {
  const detectionCount = snapshot.signals.yoloDetections.length;
  const markerCount = snapshot.minimapMarkers.length;
  const objectCount = snapshot.signals.minimapObjects.length;
  const timerFactCount = snapshot.signals.timerFacts.length;
  const screenTextFactCount = snapshot.signals.screenTextFacts.length;
  const hasModelFacts = detectionCount > 0 || markerCount > 0 || objectCount > 0 || timerFactCount > 0 || screenTextFactCount > 0;
  const rejected = snapshot.screen === "unknown" || snapshot.confidence < DETECTED_FACT_CONFIDENCE;
  if (!hasModelFacts && !rejected) return;
  const labels = [
    ...snapshot.signals.yoloDetections.map((detection) => detection.className),
    ...snapshot.signals.minimapObjects.map((object) => object.objectType),
    ...snapshot.signals.timerFacts.map((fact) => fact.timerType),
    ...snapshot.signals.screenTextFacts.map((fact) => fact.region),
  ];
  void recordVisionReflection({
    category: "live_vision",
    outcome: rejected ? "rejected" : "accepted",
    source: snapshot.source,
    screen: snapshot.screen,
    confidence: snapshot.confidence,
    reason: rejected
      ? snapshot.screen === "unknown" ? "unknown_screen" : "confidence_below_trust_threshold"
      : "model_facts_ingested",
    timestamp: snapshot.timestamp,
    detectionCount,
    markerCount,
    objectCount,
    timerFactCount,
    screenTextFactCount,
    labels,
    metadata: {
      directorScene: snapshot.directorScene,
      evidence: snapshot.evidence.slice(0, 6),
    },
  });
}

function normalizeMapObjects(value: unknown): MapObjectFact[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((value) => {
      const fact = asRecord(value);
      return {
        objectType: String(fact?.objectType ?? ""),
        minimap: normalizePoint(fact?.minimap),
        confidence: clamp01(fact?.confidence),
        source: "ultralytics-yolo" as const,
      };
    })
    .filter((fact): fact is MapObjectFact =>
      ["turtle", "lord", "ally_turret", "enemy_turret"].includes(fact.objectType) &&
      fact.minimap !== null &&
      fact.confidence >= DETECTED_FACT_CONFIDENCE)
    .slice(0, 24);
}

function normalizeTimerFacts(value: unknown): TimerFact[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((value) => {
      const fact = asRecord(value);
      return {
        timerType: String(fact?.timerType),
        text: String(fact?.text ?? ""),
        seconds: optionalNumber(fact?.seconds),
        value: optionalNumber(fact?.value),
        kills: optionalNumber(fact?.kills),
        deaths: optionalNumber(fact?.deaths),
        assists: optionalNumber(fact?.assists),
        confidence: clamp01(fact?.confidence),
        source: String(fact?.source ?? ""),
        confirmedAt: Number(fact?.confirmedAt),
      };
    })
    .filter((fact) =>
      [
        "turtle_respawn_timer",
        "lord_respawn_timer",
        "enemy_respawn_timer",
        "ally_respawn_timer",
        "minimap_objective_timer",
        "score_counter",
        "match_timer",
        "ally_kill_counter",
        "enemy_kill_counter",
        "personal_kda",
        "personal_gold_counter",
      ].includes(fact.timerType) &&
      fact.source === "timer-ocr" &&
      fact.confidence >= DETECTED_FACT_CONFIDENCE &&
      Number.isFinite(fact.confirmedAt) &&
      (Number.isFinite(fact.seconds) || Number.isFinite(fact.value) || Number.isFinite(fact.kills)))
    .map((fact) => ({ ...fact, timerType: fact.timerType as TimerFact["timerType"], source: "timer-ocr" as const }))
    .slice(0, 8);
}

function normalizeScreenTextFacts(value: unknown): ScreenTextFact[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((value) => {
      const fact = asRecord(value);
      return {
        region: String(fact?.region ?? "").trim(),
        text: String(fact?.text ?? "").replace(/\s+/g, " ").trim(),
        confidence: clamp01(fact?.confidence),
        rect: normalizeBox(fact?.rect),
        words: Array.isArray(fact?.words)
          ? fact.words.map((value: unknown) => {
            const word = asRecord(value);
            return {
              text: String(word?.text ?? "").replace(/\s+/g, " ").trim(),
              confidence: clamp01(word?.confidence),
              bbox: word?.bbox,
            };
          }).filter((word) => word.text).slice(0, 16)
          : [],
        source: String(fact?.source ?? ""),
        observedAt: Number(fact?.observedAt),
      };
    })
    .filter((fact) =>
      Boolean(fact.region) &&
      Boolean(fact.text) &&
      fact.source === "paddleocr-screen" &&
      fact.rect !== null &&
      fact.confidence >= 0.45 &&
      Number.isFinite(fact.observedAt))
    .map((fact) => ({ ...fact, rect: fact.rect!, source: "paddleocr-screen" as const }))
    .slice(0, 8);
}

function normalizePoint(value: unknown): [number, number] | null {
  if (!Array.isArray(value) || value.length !== 2) return null;
  const normalized = value.map(clamp01);
  return normalized.every((point) => Number.isFinite(point)) ? normalized as [number, number] : null;
}

function normalizeBox(value: unknown): [number, number, number, number] | null {
  if (!Array.isArray(value) || value.length !== 4) return null;
  const normalized = value.map(clamp01);
  return normalized.every((point) => Number.isFinite(point)) ? normalized as [number, number, number, number] : null;
}

function isAntiHealItem(item: string) {
  return ["Dominance Ice", "Sea Halberd", "Glowing Wand"].includes(item);
}

function finiteOrZero(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function confidenceLabel(value: number, stale = false): "low" | "medium" | "high" {
  if (stale) return "low";
  if (value >= 0.72) return "high";
  if (value >= DETECTED_FACT_CONFIDENCE) return "medium";
  return "low";
}

function clamp01(value: unknown) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.min(1, number));
}
