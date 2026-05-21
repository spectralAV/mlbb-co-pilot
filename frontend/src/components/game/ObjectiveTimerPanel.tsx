import { Timer } from "lucide-react";
import type { GameState } from "../../lib/gameTypes";
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
    onChange({ objectiveTimers: { ...state.objectiveTimers, [key]: seconds } });
  }

  return <GamePanel title="Objectives" icon={Timer}>
    <div className="space-y-3">
      {timers.map(([key, label, defaultSeconds]) => {
        const value = state.objectiveTimers[key];
        const risk = value == null ? "low" : value < 45 ? "high" : value < 75 ? "medium" : "low";
        return <div key={key} className="rounded-lg border border-white/10 bg-slate-950/60 p-3">
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm font-semibold text-slate-200">{label}</span>
            <RiskBadge risk={risk}>{value == null ? "Ready" : `${value}s`}</RiskBadge>
          </div>
          <div className="mt-2 flex gap-2">
            <button className="rounded-md bg-white/10 px-2 py-1 text-xs hover:bg-white/15" onClick={() => setTimer(key, defaultSeconds)}>Start</button>
            <button className="rounded-md bg-white/10 px-2 py-1 text-xs hover:bg-white/15" onClick={() => setTimer(key, undefined)}>Mark Taken</button>
          </div>
        </div>;
      })}
    </div>
  </GamePanel>;
}
