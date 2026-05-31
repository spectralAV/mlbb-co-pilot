import type { CvGameStatus, CvScreenType, GameEvent, GameState, LaneId, LanePressure, MapZoneId, MapZoneState, ObservationSource, ZoneStatus } from "./gameTypes";

const detectedFactConfidence = 0.55;
const strongCvConfidence = 0.72;
const staleObservationMs = 5000;
const lanes: LaneId[] = ["exp", "mid", "gold"];
const validScreens: CvScreenType[] = ["unknown", "lobby", "draft", "loading", "live_hud", "death_replay", "scoreboard", "item_shop"];
const lanePressures: LanePressure[] = ["winning", "even", "losing", "unknown"];

export type GameObservation = {
  id: string;
  source: ObservationSource;
  timestamp: number;
  confidence: number;
  screenType: CvScreenType;
  matchTimeSeconds?: number;
  minimapRecognized: boolean;
  visibleEnemies: number;
  estimatedEnemyZones: MapZoneId[];
  lanePressure?: Partial<Record<LaneId, LanePressure>>;
  dangerZones: MapZoneId[];
  objectiveTimers?: Partial<GameState["objectiveTimers"]>;
  recognizedObjectiveTimers: string[];
  detectedEvents: GameEvent[];
  raw?: unknown;
};

export function gameObservationFromLiveVision(snapshot: unknown): GameObservation | null {
  const sourceData = liveVisionRecord(snapshot);
  if (!sourceData) return null;
  const timestamp = finiteNumber(sourceData.timestamp) ?? Date.now();
  const screenType = normalizeScreen(sourceData.screen);
  const confidence = clamp01(sourceData.confidence);
  const signals = isRecord(sourceData.signals) ? sourceData.signals : {};
  const mapMonitor = isRecord(signals.mapMonitor) ? signals.mapMonitor : {};
  const markers = markerRecords(sourceData, mapMonitor);
  const visibleEnemies = markers.filter((marker) => marker.side === "enemy" && marker.status !== "last_seen" && clamp01(marker.confidence) >= detectedFactConfidence).length;
  const regions = isRecord(sourceData.regions) ? sourceData.regions : {};
  const minimapRecognized = screenType === "live_hud" && confidence >= detectedFactConfidence && (visibleEnemies > 0 || Number(mapMonitor.visibleAllies ?? 0) > 0 || isRecord(regions.minimap));
  const estimatedEnemyZones = estimateEnemyZones(markers);
  const timerFacts = recordArray(signals.timerFacts);
  const objectiveTimers = objectiveTimersFromFacts(timerFacts);
  const recognizedObjectiveTimers = recognizedObjectiveTimerTypes(timerFacts);
  const matchTimeSeconds = matchTimerFromFacts(timerFacts);
  const dangerZones = [
    ...estimatedEnemyZones,
    ...(signals.objectiveSoon ? ["objective_pit" as MapZoneId] : []),
    ...(screenType === "death_replay" && confidence >= strongCvConfidence ? ["ally_base" as MapZoneId] : [])
  ];
  return {
    id: String(sourceData.frameId ?? `${sourceData.source ?? "cv"}-${timestamp}`),
    source: "cv",
    timestamp,
    confidence,
    screenType,
    matchTimeSeconds,
    minimapRecognized,
    visibleEnemies,
    estimatedEnemyZones,
    lanePressure: normalizeLanePressure(signals.lanePressure),
    dangerZones: uniqueZones(dangerZones),
    objectiveTimers,
    recognizedObjectiveTimers,
    detectedEvents: detectedEventsFromVision(screenType, confidence, timestamp),
    raw: sourceData
  };
}

export function mergeObservationIntoGameState(state: GameState, observation: GameObservation | null): GameState {
  if (!observation) return markCvStatus(state, disconnectedStatus());
  const status = cvStatusFromObservation(observation);
  const canUseCvFacts = observation.confidence >= strongCvConfidence && !status.stale;
  const canUseMediumFacts = observation.confidence >= detectedFactConfidence && !status.stale;
  let next: GameState = { ...state, cv: status };

  if (!canUseMediumFacts) return next;

  if (canUseCvFacts && observation.matchTimeSeconds !== undefined) {
    next = { ...next, matchTimeSeconds: observation.matchTimeSeconds };
  }

  if (canUseCvFacts && observation.objectiveTimers && Object.keys(observation.objectiveTimers).length) {
    next = {
      ...next,
      objectiveTimers: {
        ...next.objectiveTimers,
        ...filterObjectiveTimers(observation.objectiveTimers)
      }
    };
  }

  if (canUseCvFacts && observation.lanePressure) {
    next = {
      ...next,
      lanePressure: mergeLanePressure(next.lanePressure, observation.lanePressure)
    };
  }

  if (observation.dangerZones.length) {
    next = {
      ...next,
      mapZones: mergeCvZones(next.mapZones, observation.dangerZones, canUseCvFacts)
    };
  }

  if (canUseCvFacts && observation.detectedEvents.length) {
    next = {
      ...next,
      events: mergeDetectedEvents(next.events, observation.detectedEvents),
      mode: observation.detectedEvents.some((event) => event.type === "death") ? "review" : next.mode
    };
  }

  return next;
}

export function cvStatusFromObservation(observation: GameObservation): CvGameStatus {
  const ageMs = Math.max(0, Date.now() - observation.timestamp);
  const stale = ageMs > staleObservationMs;
  const confidence = confidenceLabel(observation.confidence);
  const minimapWarning = observation.screenType === "live_hud" && !observation.minimapRecognized ? "Minimap not confidently recognized" : undefined;
  return {
    source: "hybrid",
    connected: !stale,
    lastObservationAt: observation.timestamp,
    confidence: stale ? "low" : confidence,
    numericConfidence: observation.confidence,
    screenType: observation.screenType,
    minimapRecognized: observation.minimapRecognized,
    objectiveTimersRecognized: observation.recognizedObjectiveTimers.length > 0,
    recognizedObjectiveTimers: observation.recognizedObjectiveTimers,
    visibleEnemies: observation.visibleEnemies,
    estimatedEnemyZones: observation.estimatedEnemyZones,
    stale,
    warning: stale ? "CV observation stale" : minimapWarning
  };
}

export function disconnectedStatus(): CvGameStatus {
  return {
    source: "hybrid",
    connected: false,
    confidence: "low",
    numericConfidence: 0,
    screenType: "unknown",
    minimapRecognized: false,
    objectiveTimersRecognized: false,
    recognizedObjectiveTimers: [],
    visibleEnemies: 0,
    estimatedEnemyZones: [],
    stale: true,
    warning: "CV disconnected"
  };
}

function markCvStatus(state: GameState, cv: CvGameStatus): GameState {
  return { ...state, cv };
}

function objectiveTimersFromFacts(timerFacts: Array<Record<string, unknown>>): Partial<GameState["objectiveTimers"]> {
  return timerFacts.reduce((timers, fact) => {
    if (Number(fact?.confidence ?? 0) < strongCvConfidence || fact?.source !== "timer-ocr") return timers;
    const seconds = finiteNumber(fact.seconds);
    if (seconds === undefined) return timers;
    if (fact.timerType === "turtle_respawn_timer") timers.turtle = seconds;
    if (fact.timerType === "lord_respawn_timer") timers.lord = seconds;
    return timers;
  }, {} as Partial<GameState["objectiveTimers"]>);
}

function recognizedObjectiveTimerTypes(timerFacts: Array<Record<string, unknown>>) {
  return timerFacts
    .filter((fact) =>
      fact?.source === "timer-ocr" &&
      Number(fact?.confidence ?? 0) >= strongCvConfidence &&
      ["turtle_respawn_timer", "lord_respawn_timer", "minimap_objective_timer"].includes(String(fact?.timerType)))
    .map((fact) => String(fact.timerType))
    .slice(0, 4);
}

function matchTimerFromFacts(timerFacts: Array<Record<string, unknown>>) {
  const fact = timerFacts.find((item) => item?.timerType === "match_timer" && item?.source === "timer-ocr" && Number(item?.confidence ?? 0) >= strongCvConfidence);
  return finiteNumber(fact?.seconds);
}

function estimateEnemyZones(markers: Array<Record<string, unknown>>): MapZoneId[] {
  return uniqueZones(markers
    .filter((marker) => marker?.side === "enemy" && Number(marker?.confidence ?? 0) >= strongCvConfidence && normalizePoint(marker.minimap))
    .map((marker) => zoneFromMinimap(normalizePoint(marker.minimap)!)));
}

function zoneFromMinimap(point: [number, number]): MapZoneId {
  const [x, y] = point.map(Number);
  if (x < 0.28 && y > 0.68) return "ally_base";
  if (x > 0.72 && y < 0.28) return "enemy_base";
  if (x < 0.4 && y < 0.45) return "river_exp";
  if (x > 0.58 && y > 0.55) return "river_gold";
  if (x < 0.48 && y > 0.56) return "ally_red";
  if (x > 0.52 && y < 0.42) return "enemy_blue";
  return "mid_lane";
}

function detectedEventsFromVision(screenType: CvScreenType, confidence: number, timestamp: number): GameEvent[] {
  if (screenType !== "death_replay" || confidence < strongCvConfidence) return [];
  return [{
    id: `cv-death-${timestamp}`,
    timestamp,
    type: "death",
    label: "CV Death Replay",
    source: "cv",
    confidence: "high"
  }];
}

function filterObjectiveTimers(timers: Partial<GameState["objectiveTimers"]>) {
  return Object.fromEntries(Object.entries(timers).filter(([, value]) => typeof value === "number" && value >= 0 && value <= 900)) as Partial<GameState["objectiveTimers"]>;
}

function mergeLanePressure(current: Record<LaneId, LanePressure>, incoming: Partial<Record<LaneId, LanePressure>>) {
  return lanes.reduce((next, lane) => {
    const value = incoming[lane];
    next[lane] = value && (current[lane] === "unknown" || value !== "unknown") ? value : current[lane];
    return next;
  }, { ...current });
}

function mergeCvZones(zones: MapZoneState[], dangerZones: MapZoneId[], strong: boolean): MapZoneState[] {
  const now = Date.now();
  const dangerSet = new Set(dangerZones);
  return zones.map((zone) => {
    if (!dangerSet.has(zone.id)) return zone;
    const status: ZoneStatus = strong ? "danger" : zone.status === "unknown" ? "contested" : zone.status;
    return { ...zone, status, notes: strong ? "High-confidence CV danger estimate" : "Low-confidence CV uncertainty", lastUpdatedAt: now };
  });
}

function mergeDetectedEvents(current: GameEvent[], incoming: GameEvent[]) {
  const fresh = incoming.filter((event) => !current.some((existing) => existing.type === event.type && existing.source === "cv" && Math.abs(existing.timestamp - event.timestamp) < 10_000));
  return [...fresh, ...current].slice(0, 80);
}

function normalizeLanePressure(value: unknown): Partial<Record<LaneId, LanePressure>> | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  const result: Partial<Record<LaneId, LanePressure>> = {};
  for (const lane of lanes) {
    if (lanePressures.includes(record[lane] as LanePressure)) result[lane] = record[lane] as LanePressure;
  }
  return Object.keys(result).length ? result : undefined;
}

function normalizeScreen(value: unknown): CvScreenType {
  return validScreens.includes(value as CvScreenType) ? value as CvScreenType : "unknown";
}

function liveVisionRecord(snapshot: unknown): Record<string, unknown> | null {
  if (!isRecord(snapshot)) return null;
  return isRecord(snapshot.data) ? snapshot.data : snapshot;
}

function markerRecords(sourceData: Record<string, unknown>, mapMonitor: Record<string, unknown>) {
  if (Array.isArray(sourceData.minimapMarkers)) return recordArray(sourceData.minimapMarkers);
  if (Array.isArray(mapMonitor.markers)) return recordArray(mapMonitor.markers);
  return [];
}

function recordArray(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function normalizePoint(value: unknown): [number, number] | null {
  if (!Array.isArray(value) || value.length !== 2) return null;
  const point = value.map(Number);
  return point.every(Number.isFinite) ? [clamp01(point[0]), clamp01(point[1])] : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function confidenceLabel(value: number): "low" | "medium" | "high" {
  if (value >= strongCvConfidence) return "high";
  if (value >= detectedFactConfidence) return "medium";
  return "low";
}

function uniqueZones(zones: Array<MapZoneId | undefined>) {
  return [...new Set(zones.filter(Boolean) as MapZoneId[])];
}

function finiteNumber(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function clamp01(value: unknown) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.min(1, number));
}
