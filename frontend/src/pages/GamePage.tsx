import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { BusyModeRecorder } from "../components/game/BusyModeRecorder";
import { CoachingFeed } from "../components/game/CoachingFeed";
import { CvStatusPanel } from "../components/game/CvStatusPanel";
import { GameStateHeader } from "../components/game/GameStateHeader";
import { GankRiskPanel } from "../components/game/GankRiskPanel";
import { LanePressurePanel } from "../components/game/LanePressurePanel";
import { MiniMapControl } from "../components/game/MiniMapControl";
import { ObjectiveTimerPanel } from "../components/game/ObjectiveTimerPanel";
import { QuickEventPad } from "../components/game/QuickEventPad";
import { getLatestLiveVision } from "../api/client";
import { disconnectedStatus, gameObservationFromLiveVision, mergeObservationIntoGameState, type GameObservation } from "../lib/gameObservation";
import { analyzeGankRisk } from "../lib/gankRiskEngine";
import { appendGameEvent, appendSnapshot, endGameSession, getActiveSession, startGameSession } from "../lib/gameSessionStore";
import { defaultGameState, type GameEvent, type GameSession, type GameState } from "../lib/gameTypes";
import { applyGameEventToState } from "../lib/liveGameEventEffects";
import { readLiveGameState, writeLiveGameState } from "../lib/liveGameStateStore";
import { getLiveCoaching } from "../lib/liveCoachingEngine";
import { useCaptureRuntimeStore } from "../runtime/captureRuntime";

export function GamePage() {
  const [searchParams] = useSearchParams();
  const [state, setState] = useState<GameState>(() => readLiveGameState() ?? defaultGameState());
  const [session, setSession] = useState<GameSession | null>(() => getActiveSession());
  const runtimeVision = useCaptureRuntimeStore((store) => store.liveVision);
  const [observation, setObservation] = useState<GameObservation | null>(null);
  const risk = useMemo(() => analyzeGankRisk(state), [state]);
  const coaching = useMemo(() => getLiveCoaching(state, risk), [state, risk]);
  const mapFocus = searchParams.get("mode") === "map";

  useEffect(() => {
    if (!session?.id) return;
    const updated = appendSnapshot(session.id, coaching, risk);
    if (updated) setSession(updated);
  }, [session?.id, coaching, risk]);

  useEffect(() => {
    writeLiveGameState(state);
  }, [state]);

  useEffect(() => {
    const next = gameObservationFromLiveVision(runtimeVision);
    if (next) setObservation(next);
  }, [runtimeVision]);

  useEffect(() => {
    let active = true;
    async function refresh() {
      try {
        const result = await getLatestLiveVision();
        if (!active) return;
        const next = gameObservationFromLiveVision(result);
        if (next) setObservation(next);
      } catch {
        setState((current) => current.cv?.connected ? { ...current, cv: disconnectedStatus() } : current);
      }
    }
    void refresh();
    const timer = window.setInterval(refresh, 1200);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    if (!observation) return;
    setState((current) => mergeObservationIntoGameState(current, observation));
    if (session?.id && observation.detectedEvents.length) {
      let updated: GameSession | null = null;
      for (const event of observation.detectedEvents) {
        updated = appendGameEvent(session.id, event) ?? updated;
      }
      if (updated) setSession(updated);
    }
  }, [observation, session?.id]);

  function patch(patch: Partial<GameState>) {
    setState((current) => ({ ...current, ...patch }));
  }

  function addEvent(event: GameEvent) {
    setState((current) => applyGameEventToState(current, event));
    if (session) {
      const updated = appendGameEvent(session.id, event);
      if (updated) setSession(updated);
    }
  }

  function toggleSession() {
    if (session) {
      endGameSession(session.id);
      setSession(null);
    } else {
      setSession(startGameSession({ hero: state.selectedHero, role: state.role }));
    }
  }

  return <div className={`game-cockpit-page ${mapFocus ? "game-cockpit-page-map-focus" : ""}`}>
    <div className="game-cockpit-hero">
      <div>
        <h2>Game</h2>
        <p>Active match cockpit for map control, gank risk, objective timing, and short coaching calls.</p>
      </div>
      <div className="game-cockpit-actions">
        <Link className="game-mode-link" to={mapFocus ? "/game" : "/game?mode=map"}>{mapFocus ? "Cockpit View" : "Map Focus"}</Link>
        <div className={`game-session-pill ${session ? "game-session-pill-live" : ""}`}>
          <span />
          {session ? "Busy recording active" : "Recorder idle"}
        </div>
        <button className="btn" onClick={toggleSession}>{session ? "Stop Recording" : "Start Busy Recording"}</button>
      </div>
    </div>
    <GameStateHeader state={state} coachingMode={coaching.mode} onChange={patch} />
    <div className="game-cockpit-grid">
      <aside className="game-cockpit-column">
        <ObjectiveTimerPanel state={state} onChange={patch} />
        <LanePressurePanel state={state} onChange={patch} />
        <QuickEventPad state={state} onEvent={addEvent} />
        <CvStatusPanel cv={state.cv} />
      </aside>
      <main className="game-cockpit-map-column">
        <MiniMapControl state={state} risk={risk} onChange={patch} />
        <BusyModeRecorder session={session} events={state.events} />
      </main>
      <aside className="game-cockpit-column">
        <CoachingFeed coaching={coaching} compact />
        <GankRiskPanel risk={risk} />
      </aside>
    </div>
  </div>;
}
