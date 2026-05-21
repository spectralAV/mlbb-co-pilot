import type { GameState, Role } from "../../lib/gameTypes";
import { formatMatchTime } from "../../lib/gameTypes";
import { RiskBadge } from "./GameShell";

const roles: Role[] = ["jungle", "exp", "gold", "mid", "roam"];

export function GameStateHeader({ state, onChange }: { state: GameState; onChange: (patch: Partial<GameState>) => void }) {
  const nextObjective = (state.objectiveTimers.turtle ?? 999) < 120 ? `Turtle in ${state.objectiveTimers.turtle}s` : (state.objectiveTimers.lord ?? 999) < 120 ? `Lord in ${state.objectiveTimers.lord}s` : "Farm window";
  const goldRisk = state.goldState === "behind" ? "high" : state.goldState === "ahead" ? "low" : "medium";

  return <header className="rounded-lg border border-cyan-500/20 bg-slate-950/70 p-4 shadow-xl">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <div className="text-xs font-bold uppercase tracking-[0.25em] text-cyan-300">MLBB Co-Pilot / Live Game</div>
        <div className="mt-1 text-2xl font-black text-white">{state.selectedHero || "Select Hero"} {state.role.toUpperCase()} / {formatMatchTime(state.matchTimeSeconds)}</div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <select className="input h-9" value={state.role} onChange={(e) => onChange({ role: e.target.value as Role })}>{roles.map((role) => <option key={role} value={role}>{role.toUpperCase()}</option>)}</select>
        <input className="input h-9 w-32" value={state.selectedHero} onChange={(e) => onChange({ selectedHero: e.target.value })} />
        <select className="input h-9" value={state.goldState} onChange={(e) => onChange({ goldState: e.target.value as GameState["goldState"] })}><option value="ahead">Ahead</option><option value="even">Even</option><option value="behind">Behind</option></select>
        <select className="input h-9" value={state.mode} onChange={(e) => onChange({ mode: e.target.value as GameState["mode"] })}><option value="live">Live</option><option value="busy">Busy</option><option value="review">Review</option></select>
        <RiskBadge risk={goldRisk}>{state.goldState}</RiskBadge>
        <RiskBadge risk={(state.objectiveTimers.turtle ?? 999) < 45 ? "high" : "medium"}>{nextObjective}</RiskBadge>
      </div>
    </div>
  </header>;
}
