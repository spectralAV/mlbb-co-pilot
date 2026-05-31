import { eventBus } from "../event-bus/eventBus.js";
import { ingestLiveReasoning } from "../engines/liveReasoningEngine.js";
import { DETECTED_FACT_CONFIDENCE, getMatchState, updateMatchVision } from "../state/matchState.js";
import { updateMinimapMonitor, type MinimapMonitorSnapshot } from "./minimapMonitor.js";
import type { ScreenTextFact } from "./screenTextRecognition.js";
import type { TimerFact } from "./timerRecognition.js";
import { recordVisionReflection } from "./visionReflection.js";

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
    enemyEquipment?: EquipmentFact[];
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

let latest: LiveVisionSnapshot | null = null;
let rememberedEnemyItems: string[] = [];
let rememberedEnemyEquipment: EquipmentFact[] = [];
let rememberedAllyItems: string[] = [];
let rememberedAllyEquipment: EquipmentFact[] = [];

export function ingestLiveVisionFrame(input: VisionFrameInput) {
  const screen = normalizeScreen(input.screen);
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

function normalizeScreen(value?: VisionScreenState): VisionScreenState {
  return ["unknown", "lobby", "draft", "loading", "live_hud", "death_replay", "scoreboard", "item_shop"].includes(String(value))
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

function normalizeStrings(value: unknown) {
  return Array.isArray(value) ? value.map(String).map((item) => item.trim()).filter(Boolean).slice(0, 10) : [];
}

function normalizeEquipmentFacts(value: unknown, side: "ally" | "enemy"): EquipmentFact[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((fact: any) => ({
      itemId: Number(fact?.itemId),
      itemName: String(fact?.itemName ?? "").trim(),
      side,
      row: Number(fact?.row),
      slot: Number(fact?.slot),
      confidence: clamp01(fact?.confidence),
      source: "equipment-item-icon" as const,
    }))
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
    .map((fact: any) => {
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
    .map((fact: any) => ({
      objectType: String(fact?.objectType ?? ""),
      minimap: normalizePoint(fact?.minimap),
      confidence: clamp01(fact?.confidence),
      source: "ultralytics-yolo" as const,
    }))
    .filter((fact): fact is MapObjectFact =>
      ["turtle", "lord", "ally_turret", "enemy_turret"].includes(fact.objectType) &&
      fact.minimap !== null &&
      fact.confidence >= DETECTED_FACT_CONFIDENCE)
    .slice(0, 24);
}

function normalizeTimerFacts(value: unknown): TimerFact[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((fact: any) => ({
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
    }))
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
    .map((fact: any) => ({
      region: String(fact?.region ?? "").trim(),
      text: String(fact?.text ?? "").replace(/\s+/g, " ").trim(),
      confidence: clamp01(fact?.confidence),
      rect: normalizeBox(fact?.rect),
      words: Array.isArray(fact?.words)
        ? fact.words.map((word: any) => ({
          text: String(word?.text ?? "").replace(/\s+/g, " ").trim(),
          confidence: clamp01(word?.confidence),
          bbox: word?.bbox,
        })).filter((word: any) => word.text).slice(0, 16)
        : [],
      source: String(fact?.source ?? ""),
      observedAt: Number(fact?.observedAt),
    }))
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

function clamp01(value: unknown) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.min(1, number));
}
