import { useEffect, useMemo, useState } from "react";
import { BusyModeRecorder } from "../components/game/BusyModeRecorder";
import { CoachingFeed } from "../components/game/CoachingFeed";
import { GameStateHeader } from "../components/game/GameStateHeader";
import { GankRiskPanel } from "../components/game/GankRiskPanel";
import { LanePressurePanel } from "../components/game/LanePressurePanel";
import { MiniMapControl } from "../components/game/MiniMapControl";
import { ObjectiveTimerPanel } from "../components/game/ObjectiveTimerPanel";
import { QuickEventPad } from "../components/game/QuickEventPad";
import { analyzeGankRisk } from "../lib/gankRiskEngine";
import { appendGameEvent, appendSnapshot, endGameSession, getActiveSession, startGameSession } from "../lib/gameSessionStore";
import { defaultGameState, type GameEvent, type GameSession, type GameState } from "../lib/gameTypes";
import { getLiveCoaching } from "../lib/liveCoachingEngine";

export function GamePage() {
  const [state, setState] = useState<GameState>(() => defaultGameState());
  const [session, setSession] = useState<GameSession | null>(() => getActiveSession());
  const risk = useMemo(() => analyzeGankRisk(state), [state]);
  const coaching = useMemo(() => getLiveCoaching(state, risk), [state, risk]);

  useEffect(() => {
    if (session) appendSnapshot(session.id, coaching, risk);
  }, [coaching.mainAction]);

  function patch(patch: Partial<GameState>) {
    setState((current) => ({ ...current, ...patch }));
  }

  function addEvent(event: GameEvent) {
    setState((current) => ({ ...current, events: [event, ...current.events] }));
    if (session) {
      const updated = appendGameEvent(session.id, event);
      if (updated) setSession(updated);
    }
    if (event.label.includes("Roam Missing")) patch({ enemyMissing: { ...state.enemyMissing, roam: true } });
    if (event.label.includes("Mid Missing")) patch({ enemyMissing: { ...state.enemyMissing, mid: true } });
    if (event.label.includes("Jungler Seen Top")) patch({ enemyMissing: { ...state.enemyMissing, jungler: false }, lastEnemySeen: { ...state.lastEnemySeen, jungler: "exp_lane" } });
    if (event.label.includes("Jungler Seen Bot")) patch({ enemyMissing: { ...state.enemyMissing, jungler: false }, lastEnemySeen: { ...state.lastEnemySeen, jungler: "gold_lane" } });
  }

  function toggleSession() {
    if (session) {
      endGameSession(session.id);
      setSession(null);
    } else {
      setSession(startGameSession({ hero: state.selectedHero, role: state.role }));
    }
  }

  return <div className="space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h2 className="text-3xl font-black">Game</h2>
        <p className="text-slate-400">Active match cockpit for map control, gank risk, objective timing, and short coaching calls.</p>
      </div>
      <button className="btn" onClick={toggleSession}>{session ? "Stop Recording" : "Start Busy Recording"}</button>
    </div>
    <GameStateHeader state={state} onChange={patch} />
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
      <div className="space-y-4 xl:col-span-3">
        <ObjectiveTimerPanel state={state} onChange={patch} />
        <LanePressurePanel state={state} onChange={patch} />
        <QuickEventPad state={state} onEvent={addEvent} />
      </div>
      <div className="space-y-4 xl:col-span-6">
        <MiniMapControl state={state} onChange={patch} />
        <BusyModeRecorder session={session} events={state.events} />
      </div>
      <div className="space-y-4 xl:col-span-3">
        <CoachingFeed coaching={coaching} />
        <GankRiskPanel risk={risk} />
      </div>
    </div>
  </div>;
}
