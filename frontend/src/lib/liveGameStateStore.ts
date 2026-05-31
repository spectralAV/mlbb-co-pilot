import { defaultGameState, type CvGameStatus, type CvScreenType, type GameEvent, type GameState, type LaneId, type LanePressure, type MapZoneId, type MapZoneState, type Role, type ZoneStatus } from "./gameTypes";

const KEY = "mlbb-copilot-live-game-state";
const lanes: LaneId[] = ["exp", "mid", "gold"];
const lanePressures: LanePressure[] = ["winning", "even", "losing", "unknown"];
const roles: Role[] = ["jungle", "exp", "gold", "mid", "roam"];
const mapZones: MapZoneId[] = ["ally_base", "enemy_base", "exp_lane", "mid_lane", "gold_lane", "ally_blue", "ally_red", "enemy_blue", "enemy_red", "river_exp", "river_gold", "objective_pit"];
const zoneStatuses: ZoneStatus[] = ["unknown", "safe", "danger", "contested", "objective"];
const eventTypes: GameEvent["type"][] = ["enemy_seen", "enemy_missing", "objective_taken", "summoner_spell_down", "ultimate_down", "fight_won", "fight_lost", "death", "rotation", "custom"];
const timerKeys = ["turtle", "lord", "allyBlue", "allyRed", "enemyBlue", "enemyRed"] as const;

export function readLiveGameState(): GameState | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) ?? "null") as unknown;
    return normalizeStoredState(parsed);
  } catch {
    return null;
  }
}

export function writeLiveGameState(state: GameState) {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(KEY, JSON.stringify(state));
}

export function subscribeLiveGameState(onState: (state: GameState) => void) {
  if (typeof window === "undefined") return () => undefined;
  const onStorage = (event: StorageEvent) => {
    if (event.key !== KEY) return;
    const state = readLiveGameState();
    if (state) onState(state);
  };
  window.addEventListener("storage", onStorage);
  return () => window.removeEventListener("storage", onStorage);
}

function normalizeStoredState(value: unknown): GameState | null {
  if (!isRecord(value)) return null;
  const fallback = defaultGameState();
  return {
    ...fallback,
    role: roles.includes(value.role as Role) ? value.role as Role : fallback.role,
    selectedHero: typeof value.selectedHero === "string" ? value.selectedHero : fallback.selectedHero,
    matchTimeSeconds: typeof value.matchTimeSeconds === "number" ? value.matchTimeSeconds : fallback.matchTimeSeconds,
    goldState: value.goldState === "ahead" || value.goldState === "even" || value.goldState === "behind" ? value.goldState : fallback.goldState,
    phase: value.phase === "early" || value.phase === "mid" || value.phase === "late" ? value.phase : fallback.phase,
    mode: value.mode === "live" || value.mode === "busy" || value.mode === "review" ? value.mode : fallback.mode,
    lanePressure: normalizeLanePressure(value.lanePressure),
    enemyMissing: isRecord(value.enemyMissing) ? {
      jungler: Boolean(value.enemyMissing.jungler),
      roam: Boolean(value.enemyMissing.roam),
      mid: Boolean(value.enemyMissing.mid)
    } : fallback.enemyMissing,
    lastEnemySeen: normalizeLastEnemySeen(value.lastEnemySeen, fallback.lastEnemySeen),
    objectiveTimers: normalizeObjectiveTimers(value.objectiveTimers, fallback.objectiveTimers),
    mapZones: normalizeMapZones(value.mapZones, fallback.mapZones),
    events: normalizeEvents(value.events),
    cv: normalizeCvStatus(value.cv, fallback.cv)
  };
}

function normalizeLanePressure(value: unknown): Record<LaneId, LanePressure> {
  const fallback = defaultGameState().lanePressure;
  if (!isRecord(value)) return fallback;
  return lanes.reduce((result, lane) => {
    const pressure = value[lane];
    result[lane] = lanePressures.includes(pressure as LanePressure) ? pressure as LanePressure : fallback[lane];
    return result;
  }, {} as Record<LaneId, LanePressure>);
}

function normalizeLastEnemySeen(value: unknown, fallback: GameState["lastEnemySeen"]): GameState["lastEnemySeen"] {
  if (!isRecord(value)) return fallback;
  return {
    jungler: normalizeZoneId(value.jungler),
    roam: normalizeZoneId(value.roam),
    mid: normalizeZoneId(value.mid)
  };
}

function normalizeObjectiveTimers(value: unknown, fallback: GameState["objectiveTimers"]): GameState["objectiveTimers"] {
  if (!isRecord(value)) return fallback;
  return timerKeys.reduce((timers, key) => {
    const seconds = normalizeTimer(value[key]);
    if (seconds !== undefined) timers[key] = seconds;
    return timers;
  }, {} as GameState["objectiveTimers"]);
}

function normalizeMapZones(value: unknown, fallback: MapZoneState[]): MapZoneState[] {
  if (!Array.isArray(value)) return fallback;
  const normalized = value
    .filter(isRecord)
    .map((zone): MapZoneState | null => {
      const id = normalizeZoneId(zone.id);
      if (!id) return null;
      return {
        id,
        status: zoneStatuses.includes(zone.status as ZoneStatus) ? zone.status as ZoneStatus : "unknown",
        lastUpdatedAt: normalizeTimestamp(zone.lastUpdatedAt),
        notes: typeof zone.notes === "string" ? zone.notes.slice(0, 180) : undefined
      } satisfies MapZoneState;
    })
    .filter((zone): zone is MapZoneState => Boolean(zone));
  return normalized.length ? normalized : fallback;
}

function normalizeEvents(value: unknown): GameEvent[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(isRecord)
    .map((event): GameEvent | null => {
      const type = eventTypes.includes(event.type as GameEvent["type"]) ? event.type as GameEvent["type"] : "custom";
      const label = typeof event.label === "string" && event.label.trim() ? event.label.trim().slice(0, 120) : null;
      if (!label) return null;
      return {
        id: typeof event.id === "string" && event.id ? event.id : `event-${normalizeTimestamp(event.timestamp)}`,
        timestamp: normalizeTimestamp(event.timestamp),
        matchTime: typeof event.matchTime === "string" ? event.matchTime : undefined,
        type,
        label,
        zone: normalizeZoneId(event.zone),
        hero: typeof event.hero === "string" ? event.hero : undefined,
        source: event.source === "cv" || event.source === "hybrid" || event.source === "manual" ? event.source : undefined,
        confidence: event.confidence === "high" || event.confidence === "medium" || event.confidence === "low" ? event.confidence : undefined
      } satisfies GameEvent;
    })
    .filter((event): event is GameEvent => Boolean(event))
    .slice(0, 80);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function normalizeCvStatus(value: unknown, fallback: CvGameStatus | undefined): CvGameStatus | undefined {
  if (!isRecord(value)) return fallback;
  const confidence = value.confidence === "high" || value.confidence === "medium" || value.confidence === "low" ? value.confidence : fallback?.confidence ?? "low";
  const screenType = ["unknown", "lobby", "draft", "loading", "live_hud", "death_replay", "scoreboard", "item_shop"].includes(String(value.screenType))
    ? value.screenType as CvScreenType
    : fallback?.screenType ?? "unknown";
  return {
    source: value.source === "cv" ? "cv" : "hybrid",
    connected: Boolean(value.connected),
    lastObservationAt: typeof value.lastObservationAt === "number" ? value.lastObservationAt : undefined,
    confidence,
    numericConfidence: typeof value.numericConfidence === "number" ? value.numericConfidence : undefined,
    screenType,
    minimapRecognized: Boolean(value.minimapRecognized),
    visibleEnemies: Math.max(0, Math.floor(Number(value.visibleEnemies) || 0)),
    estimatedEnemyZones: Array.isArray(value.estimatedEnemyZones) ? value.estimatedEnemyZones.map(normalizeZoneId).filter((zone): zone is MapZoneId => Boolean(zone)) : [],
    stale: Boolean(value.stale),
    warning: typeof value.warning === "string" ? value.warning : undefined
  };
}

function normalizeZoneId(value: unknown): MapZoneId | undefined {
  return mapZones.includes(value as MapZoneId) ? value as MapZoneId : undefined;
}

function normalizeTimer(value: unknown): number | undefined {
  const seconds = Number(value);
  if (!Number.isFinite(seconds)) return undefined;
  return Math.max(0, Math.min(900, Math.floor(seconds)));
}

function normalizeTimestamp(value: unknown): number {
  const timestamp = Number(value);
  return Number.isFinite(timestamp) && timestamp > 0 ? timestamp : Date.now();
}
