import { Timer } from "lucide-react";
import type { GameState } from "../../lib/gameTypes";
import { markObjectiveTaken } from "../../lib/liveGameEventEffects";
import { RiskBadge, GamePanel } from "./GameShell";

const timers = [
  ["turtle", "Turtle", 120],
  ["lord", "Lord", 180],
  ["allyBlue", "Own Blue", 90],
  ["allyRed", "Own Red", 90],
  ["enemyBlue", "Enemy Blue", 90],
  ["enemyRed", "Enemy Red", 90]
] as const;

export function ObjectiveTimerPanel({ state, onChange }: { state: GameState; onChange: (patch: Partial<GameState>) => void }) {
  function setTimer(key: keyof GameState["objectiveTimers"], seconds: number | undefined) {
    onChange({ objectiveTimers: { ...state.objectiveTimers, [key]: normalizeTimer(seconds) } });
  }

  function markTaken(key: keyof GameState["objectiveTimers"], seconds: number) {
    if (key === "turtle" || key === "lord") {
      onChange(markObjectiveTaken(state, key));
      return;
    }
    setTimer(key, seconds);
  }

  return <GamePanel title="Objectives" icon={Timer}>
    <div className="objective-timer-grid">
      {timers.map(([key, label, defaultSeconds]) => {
        const value = normalizeTimer(state.objectiveTimers[key]);
        const risk = value == null ? "low" : value < 45 ? "high" : value < 75 ? "medium" : "low";
        return <div key={key} className="objective-timer-card">
          <div className="objective-timer-card-head">
            <span className="text-sm font-semibold text-slate-200">{label}</span>
            <RiskBadge risk={risk}>{value == null ? "Ready" : `${value}s`}</RiskBadge>
          </div>
          <div className="objective-timer-actions">
            <button className="rounded-md bg-white/10 px-2 py-1 text-xs hover:bg-white/15" onClick={() => setTimer(key, defaultSeconds)}>Start</button>
            <button className="rounded-md bg-white/10 px-2 py-1 text-xs hover:bg-white/15" onClick={() => markTaken(key, defaultSeconds)}>Taken</button>
          </div>
        </div>;
      })}
    </div>
  </GamePanel>;
}

function normalizeTimer(seconds: number | undefined) {
  if (typeof seconds !== "number" || !Number.isFinite(seconds)) return undefined;
  return Math.max(0, Math.min(900, Math.floor(seconds)));
}
