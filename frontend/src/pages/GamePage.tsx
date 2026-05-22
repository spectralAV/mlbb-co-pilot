import { useEffect, useMemo, useState } from "react";
import type { ReactElement } from "react";
import { BusyModeRecorder } from "../components/game/BusyModeRecorder";
import { CoachingFeed } from "../components/game/CoachingFeed";
import { GameStateHeader } from "../components/game/GameStateHeader";
import { GankRiskPanel } from "../components/game/GankRiskPanel";
import { LanePressurePanel } from "../components/game/LanePressurePanel";
import { MiniMapControl } from "../components/game/MiniMapControl";
import { ObjectiveTimerPanel } from "../components/game/ObjectiveTimerPanel";
import { QuickEventPad } from "../components/game/QuickEventPad";
import { ArrowDown, ArrowUp, GripVertical, RotateCcw } from "lucide-react";
import { analyzeGankRisk } from "../lib/gankRiskEngine";
import { appendGameEvent, appendSnapshot, endGameSession, getActiveSession, startGameSession } from "../lib/gameSessionStore";
import { defaultGameState, type GameEvent, type GameSession, type GameState } from "../lib/gameTypes";
import { getLiveCoaching } from "../lib/liveCoachingEngine";

type PanelId = "objectives" | "lane" | "quick" | "map" | "recorder" | "coach" | "risk";

const defaultPanelOrder: PanelId[] = ["objectives", "map", "coach", "lane", "recorder", "risk", "quick"];
const panelStorageKey = "mlbb.game.panelOrder.v1";

function loadPanelOrder() {
  try {
    const parsed = JSON.parse(localStorage.getItem(panelStorageKey) ?? "[]");
    if (!Array.isArray(parsed)) return defaultPanelOrder;
    const known = new Set(defaultPanelOrder);
    const next = parsed.filter((id): id is PanelId => known.has(id));
    return [...next, ...defaultPanelOrder.filter((id) => !next.includes(id))];
  } catch {
    return defaultPanelOrder;
  }
}

export function GamePage() {
  const [state, setState] = useState<GameState>(() => defaultGameState());
  const [session, setSession] = useState<GameSession | null>(() => getActiveSession());
  const [panelOrder, setPanelOrder] = useState<PanelId[]>(loadPanelOrder);
  const risk = useMemo(() => analyzeGankRisk(state), [state]);
  const coaching = useMemo(() => getLiveCoaching(state, risk), [state, risk]);

  useEffect(() => {
    if (session) appendSnapshot(session.id, coaching, risk);
  }, [coaching.mainAction]);

  useEffect(() => {
    localStorage.setItem(panelStorageKey, JSON.stringify(panelOrder));
  }, [panelOrder]);

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

  function movePanel(id: PanelId, direction: -1 | 1) {
    setPanelOrder((current) => {
      const index = current.indexOf(id);
      const nextIndex = index + direction;
      if (index < 0 || nextIndex < 0 || nextIndex >= current.length) return current;
      const next = [...current];
      [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
      return next;
    });
  }

  const panels: Record<PanelId, { label: string; wide?: boolean; render: () => ReactElement }> = {
    objectives: { label: "Objectives", render: () => <ObjectiveTimerPanel state={state} onChange={patch} /> },
    lane: { label: "Lane Pressure", render: () => <LanePressurePanel state={state} onChange={patch} /> },
    quick: { label: "Quick Events", render: () => <QuickEventPad state={state} onEvent={addEvent} /> },
    map: { label: "Tactical Map Control", wide: true, render: () => <MiniMapControl state={state} onChange={patch} /> },
    recorder: { label: "Busy Recorder", wide: true, render: () => <BusyModeRecorder session={session} events={state.events} /> },
    coach: { label: "Coaching Feed", render: () => <CoachingFeed coaching={coaching} /> },
    risk: { label: "Gank Risk", render: () => <GankRiskPanel risk={risk} /> }
  };

  return <div className="space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h2 className="text-3xl font-black">Game</h2>
        <p className="text-slate-400">Active match cockpit for map control, gank risk, objective timing, and short coaching calls.</p>
      </div>
      <button className="btn" onClick={toggleSession}>{session ? "Stop Recording" : "Start Busy Recording"}</button>
    </div>
    <GameStateHeader state={state} onChange={patch} />
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-white/10 bg-white/5 p-2">
      <div className="text-sm text-slate-300">Move sections with the arrows. Layout is saved on this device.</div>
      <button className="min-h-10 rounded-lg bg-white/10 px-3 text-sm text-slate-200 active:bg-white/20" onClick={() => setPanelOrder(defaultPanelOrder)}><RotateCcw className="mr-2 inline h-4 w-4" />Reset layout</button>
    </div>
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
      {panelOrder.map((id, index) => {
        const panel = panels[id];
        return <article key={id} className={panel.wide ? "xl:col-span-6" : "xl:col-span-3"}>
          <div className="mb-2 flex min-h-11 items-center justify-between rounded-lg border border-white/10 bg-slate-950/70 px-2">
            <div className="flex min-w-0 items-center gap-2 text-xs font-bold uppercase tracking-wide text-slate-300"><GripVertical className="h-4 w-4 text-slate-500" /><span className="truncate">{panel.label}</span></div>
            <div className="flex gap-1">
              <button className="grid h-9 w-9 place-items-center rounded-md bg-white/10 text-slate-200 disabled:opacity-30 active:bg-white/20" disabled={index === 0} onClick={() => movePanel(id, -1)} aria-label={`Move ${panel.label} earlier`}><ArrowUp className="h-4 w-4" /></button>
              <button className="grid h-9 w-9 place-items-center rounded-md bg-white/10 text-slate-200 disabled:opacity-30 active:bg-white/20" disabled={index === panelOrder.length - 1} onClick={() => movePanel(id, 1)} aria-label={`Move ${panel.label} later`}><ArrowDown className="h-4 w-4" /></button>
            </div>
          </div>
          {panel.render()}
        </article>;
      })}
    </div>
  </div>;
}
