import type { GameEvent, GameSession, GankRiskOutput, LiveCoachingOutput, Role } from "./gameTypes";

const KEY = "mlbb-copilot-game-sessions";
const ACTIVE_KEY = "mlbb-copilot-active-game-session";

function readSessions(): GameSession[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "[]") as GameSession[];
  } catch {
    return [];
  }
}

function writeSessions(sessions: GameSession[]) {
  localStorage.setItem(KEY, JSON.stringify(sessions));
}

export function listGameSessions() {
  return readSessions().sort((a, b) => b.startedAt - a.startedAt);
}

export function getActiveSession() {
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
  localStorage.setItem(ACTIVE_KEY, session.id);
  return session;
}

export function appendGameEvent(sessionId: string, event: GameEvent) {
  const sessions = readSessions().map((session) => session.id === sessionId ? { ...session, events: [event, ...session.events] } : session);
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
  localStorage.removeItem(ACTIVE_KEY);
}

export function saveSessionNote(sessionId: string, note: string) {
  const clean = note.trim();
  if (!clean) return;
  writeSessions(readSessions().map((session) => session.id === sessionId ? { ...session, notes: [clean, ...session.notes] } : session));
}
