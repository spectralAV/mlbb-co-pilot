export type Role = "jungle" | "exp" | "gold" | "mid" | "roam";
export type Risk = "low" | "medium" | "high" | "critical";
export type LaneId = "exp" | "mid" | "gold";
export type LanePressure = "winning" | "even" | "losing" | "unknown";
export type ObservationSource = "manual" | "cv" | "hybrid";
export type CvScreenType =
  | "unknown"
  | "lobby"
  | "draft"
  | "loading"
  | "live_hud"
  | "death_replay"
  | "scoreboard"
  | "item_shop";

export type MapZoneId =
  | "ally_base"
  | "enemy_base"
  | "exp_lane"
  | "mid_lane"
  | "gold_lane"
  | "ally_blue"
  | "ally_red"
  | "enemy_blue"
  | "enemy_red"
  | "river_exp"
  | "river_gold"
  | "objective_pit";

export type ZoneStatus = "unknown" | "safe" | "danger" | "contested" | "objective";

export interface MapZoneState {
  id: MapZoneId;
  status: ZoneStatus;
  lastUpdatedAt: number;
  notes?: string;
}

export interface GameEvent {
  id: string;
  timestamp: number;
  matchTime?: string;
  type:
    | "enemy_seen"
    | "enemy_missing"
    | "objective_taken"
    | "summoner_spell_down"
    | "ultimate_down"
    | "fight_won"
    | "fight_lost"
    | "death"
    | "rotation"
    | "custom";
  label: string;
  zone?: MapZoneId;
  hero?: string;
  source?: ObservationSource;
  confidence?: "low" | "medium" | "high";
}

export interface CvGameStatus {
  source: "cv" | "hybrid";
  connected: boolean;
  lastObservationAt?: number;
  confidence: "low" | "medium" | "high";
  numericConfidence?: number;
  screenType: CvScreenType;
  minimapRecognized: boolean;
  objectiveTimersRecognized?: boolean;
  recognizedObjectiveTimers?: string[];
  visibleEnemies: number;
  estimatedEnemyZones: MapZoneId[];
  stale: boolean;
  warning?: string;
}

export interface GameState {
  role: Role;
  selectedHero: string;
  matchTimeSeconds: number;
  goldState: "ahead" | "even" | "behind";
  phase: "early" | "mid" | "late";
  mode: "live" | "busy" | "review";
  lanePressure: Record<LaneId, LanePressure>;
  enemyMissing: {
    jungler?: boolean;
    roam?: boolean;
    mid?: boolean;
  };
  lastEnemySeen: {
    jungler?: MapZoneId;
    roam?: MapZoneId;
    mid?: MapZoneId;
  };
  objectiveTimers: {
    turtle?: number;
    lord?: number;
    allyBlue?: number;
    allyRed?: number;
    enemyBlue?: number;
    enemyRed?: number;
  };
  mapZones: MapZoneState[];
  events: GameEvent[];
  cv?: CvGameStatus;
}

export interface GankRiskOutput {
  lanes: Record<LaneId, { risk: Risk; reasons: string[] }>;
  mapZones: Array<{ zone: MapZoneId; risk: Risk; reason: string }>;
  recommendation: {
    action: "farm" | "gank" | "counter_gank" | "invade" | "defend" | "reset" | "group" | "trade" | "avoid_fight";
    targetZone?: MapZoneId;
    text: string;
    confidence: "low" | "medium" | "high";
  };
  warnings: string[];
}

export interface LiveCoachingOutput {
  mainAction: string;
  reason: string;
  warnings: string[];
  priority: "low" | "medium" | "high" | "urgent";
  mode: "farm" | "fight" | "objective" | "defend" | "reset" | "rotate";
  scenarioId?: string;
  secondaryActions?: string[];
  avoid?: string[];
  confidence?: "low" | "medium" | "high";
}

export interface GameSession {
  id: string;
  startedAt: number;
  endedAt?: number;
  hero?: string;
  role: Role;
  result?: "win" | "loss" | "unknown";
  events: GameEvent[];
  coachingSnapshots: LiveCoachingOutput[];
  gankRiskSnapshots: GankRiskOutput[];
  notes: string[];
}

export const defaultMapZones = (): MapZoneState[] => [
  "ally_base",
  "enemy_base",
  "exp_lane",
  "mid_lane",
  "gold_lane",
  "ally_blue",
  "ally_red",
  "enemy_blue",
  "enemy_red",
  "river_exp",
  "river_gold",
  "objective_pit"
].map((id) => ({ id: id as MapZoneId, status: id === "objective_pit" ? "objective" : "unknown", lastUpdatedAt: Date.now() }));

export const defaultGameState = (): GameState => ({
  role: "jungle",
  selectedHero: "Julian",
  matchTimeSeconds: 272,
  goldState: "ahead",
  phase: "early",
  mode: "live",
  lanePressure: { exp: "even", mid: "even", gold: "losing" },
  enemyMissing: { jungler: true, roam: true, mid: false },
  lastEnemySeen: { jungler: "enemy_red", roam: "river_gold" },
  objectiveTimers: { turtle: 38, allyBlue: 72, allyRed: 55, enemyBlue: 29 },
  mapZones: defaultMapZones(),
  events: [],
  cv: {
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
  }
});

export function formatMatchTime(seconds: number) {
  const safeSeconds = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
  const minutes = Math.floor(safeSeconds / 60);
  const rest = safeSeconds % 60;
  return `${minutes}:${String(rest).padStart(2, "0")}`;
}

export function riskTone(risk: Risk | "LOW" | "MEDIUM" | "HIGH" | "CRITICAL") {
  const normalized = risk.toLowerCase();
  return {
    low: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
    medium: "bg-yellow-500/15 text-yellow-300 border-yellow-500/30",
    high: "bg-orange-500/15 text-orange-300 border-orange-500/30",
    critical: "bg-red-500/20 text-red-300 border-red-500/40"
  }[normalized] ?? "bg-emerald-500/15 text-emerald-300 border-emerald-500/30";
}
