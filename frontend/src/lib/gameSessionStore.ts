import type { GameEvent, GameSession, GankRiskOutput, LaneId, LiveCoachingOutput, MapZoneId, Risk, Role } from "./gameTypes";

const KEY = "mlbb-copilot-game-sessions";
const ACTIVE_KEY = "mlbb-copilot-active-game-session";
const roles: Role[] = ["jungle", "exp", "gold", "mid", "roam"];
const risks: Risk[] = ["low", "medium", "high", "critical"];
const coachingPriorities: LiveCoachingOutput["priority"][] = ["low", "medium", "high", "urgent"];
const coachingModes: LiveCoachingOutput["mode"][] = ["farm", "fight", "objective", "defend", "reset", "rotate"];
const eventTypes: GameEvent["type"][] = ["enemy_seen", "enemy_missing", "objective_taken", "summoner_spell_down", "ultimate_down", "fight_won", "fight_lost", "death", "rotation", "custom"];
const mapZones: MapZoneId[] = ["ally_base", "enemy_base", "exp_lane", "mid_lane", "gold_lane", "ally_blue", "ally_red", "enemy_blue", "enemy_red", "river_exp", "river_gold", "objective_pit"];

function readSessions(): GameSession[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) ?? "[]") as unknown;
    return Array.isArray(parsed) ? parsed.map(normalizeSession).filter((session): session is GameSession => Boolean(session)) : [];
  } catch {
    return [];
  }
}

function writeSessions(sessions: GameSession[]) {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(KEY, JSON.stringify(sessions));
}

export function listGameSessions() {
  return readSessions().sort((a, b) => b.startedAt - a.startedAt);
}

export function getActiveSession() {
  if (typeof localStorage === "undefined") return null;
  const id = localStorage.getItem(ACTIVE_KEY);
  return readSessions().find((session) => session.id === id) ?? null;
}

export function startGameSession(input: { hero?: string; role: Role }) {
  const session: GameSession = {
    id: crypto.randomUUID(),
    startedAt: Date.now(),
    hero: input.hero,
    role: input.role,
    result: "unknown",
    events: [],
    coachingSnapshots: [],
    gankRiskSnapshots: [],
    notes: []
  };
  writeSessions([session, ...readSessions()]);
  if (typeof localStorage !== "undefined") localStorage.setItem(ACTIVE_KEY, session.id);
  return session;
}

export function appendGameEvent(sessionId: string, event: GameEvent) {
  const sessions = readSessions().map((session) => {
    if (session.id !== sessionId) return session;
    if (session.events.some((existing) => existing.id === event.id)) return session;
    return { ...session, events: [event, ...session.events].slice(0, 120) };
  });
  writeSessions(sessions);
  return sessions.find((session) => session.id === sessionId) ?? null;
}

export function appendSnapshot(sessionId: string, coaching: LiveCoachingOutput, risk: GankRiskOutput) {
  const sessions = readSessions().map((session) => session.id === sessionId ? {
    ...session,
    coachingSnapshots: [coaching, ...session.coachingSnapshots].slice(0, 50),
    gankRiskSnapshots: [risk, ...session.gankRiskSnapshots].slice(0, 50)
  } : session);
  writeSessions(sessions);
  return sessions.find((session) => session.id === sessionId) ?? null;
}

export function endGameSession(sessionId: string, result: "win" | "loss" | "unknown" = "unknown") {
  const sessions = readSessions().map((session) => session.id === sessionId ? { ...session, endedAt: Date.now(), result } : session);
  writeSessions(sessions);
  if (typeof localStorage !== "undefined") localStorage.removeItem(ACTIVE_KEY);
}

export function saveSessionNote(sessionId: string, note: string) {
  const clean = note.trim();
  if (!clean) return;
  writeSessions(readSessions().map((session) => session.id === sessionId ? { ...session, notes: [clean, ...session.notes] } : session));
}

function normalizeSession(value: unknown): GameSession | null {
  if (!isRecord(value)) return null;
  const id = typeof value.id === "string" && value.id ? value.id : null;
  if (!id) return null;
  return {
    id,
    startedAt: normalizeTimestamp(value.startedAt),
    endedAt: typeof value.endedAt === "number" ? normalizeTimestamp(value.endedAt) : undefined,
    hero: typeof value.hero === "string" ? value.hero : undefined,
    role: roles.includes(value.role as Role) ? value.role as Role : "jungle",
    result: value.result === "win" || value.result === "loss" || value.result === "unknown" ? value.result : "unknown",
    events: normalizeEvents(value.events),
    coachingSnapshots: normalizeCoachingSnapshots(value.coachingSnapshots),
    gankRiskSnapshots: normalizeGankRiskSnapshots(value.gankRiskSnapshots),
    notes: Array.isArray(value.notes) ? value.notes.filter((note): note is string => typeof note === "string").slice(0, 80) : []
  };
}

function normalizeEvents(value: unknown): GameEvent[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(isRecord)
    .map((event): GameEvent | null => {
      const label = typeof event.label === "string" && event.label.trim() ? event.label.trim().slice(0, 120) : null;
      if (!label) return null;
      return {
        id: typeof event.id === "string" && event.id ? event.id : `event-${normalizeTimestamp(event.timestamp)}`,
        timestamp: normalizeTimestamp(event.timestamp),
        matchTime: typeof event.matchTime === "string" ? event.matchTime : undefined,
        type: eventTypes.includes(event.type as GameEvent["type"]) ? event.type as GameEvent["type"] : "custom",
        label,
        zone: normalizeZoneId(event.zone),
        hero: typeof event.hero === "string" ? event.hero : undefined,
        source: event.source === "manual" || event.source === "cv" || event.source === "hybrid" ? event.source : undefined,
        confidence: event.confidence === "low" || event.confidence === "medium" || event.confidence === "high" ? event.confidence : undefined
      } satisfies GameEvent;
    })
    .filter((event): event is GameEvent => Boolean(event))
    .slice(0, 120);
}

function normalizeCoachingSnapshots(value: unknown): LiveCoachingOutput[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(isRecord)
    .map((snapshot) => ({
      mainAction: typeof snapshot.mainAction === "string" && snapshot.mainAction ? snapshot.mainAction : "Hold safe position.",
      reason: typeof snapshot.reason === "string" && snapshot.reason ? snapshot.reason : "Partial coaching snapshot.",
      warnings: stringList(snapshot.warnings, 3),
      priority: coachingPriorities.includes(snapshot.priority as LiveCoachingOutput["priority"]) ? snapshot.priority as LiveCoachingOutput["priority"] : "low",
      mode: coachingModes.includes(snapshot.mode as LiveCoachingOutput["mode"]) ? snapshot.mode as LiveCoachingOutput["mode"] : "farm",
      scenarioId: typeof snapshot.scenarioId === "string" ? snapshot.scenarioId : undefined,
      secondaryActions: stringList(snapshot.secondaryActions, 4),
      avoid: stringList(snapshot.avoid, 4),
      confidence: snapshot.confidence === "low" || snapshot.confidence === "medium" || snapshot.confidence === "high" ? snapshot.confidence : "medium"
    } satisfies LiveCoachingOutput))
    .slice(0, 50);
}

function normalizeGankRiskSnapshots(value: unknown): GankRiskOutput[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(isRecord)
    .map((snapshot) => {
      const recommendation = isRecord(snapshot.recommendation) ? snapshot.recommendation : {};
      return {
        lanes: {
          exp: normalizeLaneRisk(snapshot.lanes, "exp"),
          mid: normalizeLaneRisk(snapshot.lanes, "mid"),
          gold: normalizeLaneRisk(snapshot.lanes, "gold")
        },
        mapZones: Array.isArray(snapshot.mapZones)
          ? snapshot.mapZones.filter(isRecord).map((zone) => ({
            zone: normalizeZoneId(zone.zone) ?? "objective_pit",
            risk: normalizeRisk(zone.risk, "medium"),
            reason: typeof zone.reason === "string" && zone.reason ? zone.reason : "Map pressure signal."
          })).slice(0, 8)
          : [],
        recommendation: {
          action: isRecommendationAction(recommendation.action) ? recommendation.action : "farm",
          targetZone: normalizeZoneId(recommendation.targetZone),
          text: typeof recommendation.text === "string" && recommendation.text ? recommendation.text : "Farm safely and update enemy locations.",
          confidence: recommendation.confidence === "low" || recommendation.confidence === "medium" || recommendation.confidence === "high" ? recommendation.confidence : "medium"
        },
        warnings: stringList(snapshot.warnings, 3)
      } satisfies GankRiskOutput;
    })
    .slice(0, 50);
}

function normalizeLaneRisk(value: unknown, lane: LaneId): GankRiskOutput["lanes"][LaneId] {
  const lanesRecord = isRecord(value) ? value : {};
  const laneRisk = isRecord(lanesRecord[lane]) ? lanesRecord[lane] : {};
  return {
    risk: normalizeRisk(laneRisk.risk),
    reasons: stringList(laneRisk.reasons, 3, ["No current risk signal."])
  };
}

function normalizeTimestamp(value: unknown): number {
  const timestamp = Number(value);
  return Number.isFinite(timestamp) && timestamp > 0 ? timestamp : Date.now();
}

function normalizeZoneId(value: unknown): MapZoneId | undefined {
  return mapZones.includes(value as MapZoneId) ? value as MapZoneId : undefined;
}

function normalizeRisk(value: unknown, fallback: Risk = "low"): Risk {
  return risks.includes(value as Risk) ? value as Risk : fallback;
}

function stringList(value: unknown, limit: number, fallback: string[] = []): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && Boolean(item)).slice(0, limit) : fallback;
}

function isRecommendationAction(value: unknown): value is GankRiskOutput["recommendation"]["action"] {
  return ["farm", "gank", "counter_gank", "invade", "defend", "reset", "group", "trade", "avoid_fight"].includes(String(value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
