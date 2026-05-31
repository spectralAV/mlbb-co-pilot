import type { GameState, LiveCoachingOutput, Role } from "../../lib/gameTypes";
import { formatMatchTime } from "../../lib/gameTypes";
import { RiskBadge } from "./GameShell";

const roles: Role[] = ["jungle", "exp", "gold", "mid", "roam"];
const phaseLabels: Record<GameState["phase"], string> = { early: "Early", mid: "Mid", late: "Late" };

export function GameStateHeader({ state, coachingMode = "farm", onChange }: { state: GameState; coachingMode?: LiveCoachingOutput["mode"]; onChange: (patch: Partial<GameState>) => void }) {
  const turtleTimer = state.objectiveTimers?.turtle;
  const lordTimer = state.objectiveTimers?.lord;
  const nextObjectiveTimers: Array<{ label: "Turtle" | "Lord"; seconds: number }> = [];
  if (typeof turtleTimer === "number") nextObjectiveTimers.push({ label: "Turtle", seconds: turtleTimer });
  if (typeof lordTimer === "number") nextObjectiveTimers.push({ label: "Lord", seconds: lordTimer });
  const nextObjectiveTimer = nextObjectiveTimers.sort((a, b) => a.seconds - b.seconds)[0];
  const nextObjective = nextObjectiveTimer ? `${nextObjectiveTimer.label} in ${nextObjectiveTimer.seconds}s` : "Farm window";
  const nextObjectiveRisk = !nextObjectiveTimer ? "low" : nextObjectiveTimer.seconds < 30 ? "high" : nextObjectiveTimer.seconds < 60 ? "medium" : "low";
  const goldState = state.goldState ?? "even";
  const gameMode = state.mode ?? "live";
  const goldRisk = goldState === "behind" ? "high" : goldState === "ahead" ? "low" : "medium";
  const role = state.role ?? "jungle";
  const phase = state.phase ?? "early";
  const selectedHero = state.selectedHero || "Select Hero";

  return <header className="game-state-header">
    <div className="game-state-header-grid">
      <div>
        <div className="game-kicker">MLBB Co-Pilot / Live Game</div>
        <div className="game-state-title">{selectedHero} / {formatMatchTime(state.matchTimeSeconds ?? 0)}</div>
        <div className="game-state-strip" aria-label="Live game state">
          <div><span>Role</span><b>{role.toUpperCase()}</b></div>
          <div><span>Phase</span><b>{phaseLabels[phase]}</b></div>
          <div><span>Objective</span><b>{nextObjective}</b></div>
          <div><span>Coach</span><b>{coachingMode}</b></div>
        </div>
      </div>
      <div className="game-state-controls">
        <select className="input h-11 w-full sm:w-auto" value={role} onChange={(e) => onChange({ role: e.target.value as Role })}>{roles.map((role) => <option key={role} value={role}>{role.toUpperCase()}</option>)}</select>
        <input className="input h-11 w-full sm:w-32" value={selectedHero === "Select Hero" ? "" : selectedHero} onChange={(e) => onChange({ selectedHero: e.target.value })} aria-label="Selected hero" />
        <select className="input h-11 w-full sm:w-auto" value={phase} onChange={(e) => onChange({ phase: e.target.value as GameState["phase"] })}><option value="early">Early</option><option value="mid">Mid</option><option value="late">Late</option></select>
        <select className="input h-11 w-full sm:w-auto" value={goldState} onChange={(e) => onChange({ goldState: e.target.value as GameState["goldState"] })}><option value="ahead">Ahead</option><option value="even">Even</option><option value="behind">Behind</option></select>
        <select className="input h-11 w-full sm:w-auto" value={gameMode} onChange={(e) => onChange({ mode: e.target.value as GameState["mode"] })}><option value="live">Live</option><option value="busy">Busy</option><option value="review">Review</option></select>
        <RiskBadge risk={goldRisk}>{goldState}</RiskBadge>
        <RiskBadge risk={nextObjectiveRisk}>{nextObjective}</RiskBadge>
        <RiskBadge risk="medium">{coachingMode}</RiskBadge>
      </div>
    </div>
  </header>;
}
