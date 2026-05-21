import { Activity } from "lucide-react";
import type { GameState, LaneId, LanePressure, Risk } from "../../lib/gameTypes";
import { GamePanel, RiskBadge } from "./GameShell";

const lanes: LaneId[] = ["exp", "mid", "gold"];
const pressureOptions: LanePressure[] = ["winning", "even", "losing", "unknown"];

export function laneRiskFromPressure(pressure: LanePressure): Risk {
  if (pressure === "losing") return "critical";
  if (pressure === "even") return "medium";
  if (pressure === "winning") return "low";
  return "medium";
}

export function LanePressurePanel({ state, onChange }: { state: GameState; onChange: (patch: Partial<GameState>) => void }) {
  return <GamePanel title="Lane Pressure" icon={Activity}>
    <div className="space-y-3">
      {lanes.map((lane) => {
        const pressure = state.lanePressure[lane];
        const risk = laneRiskFromPressure(pressure);
        const action = pressure === "losing" ? "Avoid forcing unless roam nearby." : pressure === "winning" ? "Can pressure and rotate." : "Clear wave before river.";
        return <div key={lane} className="rounded-lg border border-white/10 bg-slate-950/60 p-3">
          <div className="flex items-center justify-between">
            <b className="uppercase text-slate-100">{lane}</b>
            <RiskBadge risk={risk}>{pressure}</RiskBadge>
          </div>
          <select className="input mt-2 h-8 w-full" value={pressure} onChange={(e) => onChange({ lanePressure: { ...state.lanePressure, [lane]: e.target.value as LanePressure } })}>{pressureOptions.map((option) => <option key={option} value={option}>{option}</option>)}</select>
          <div className="mt-2 text-xs text-slate-400">{action}</div>
        </div>;
      })}
    </div>
  </GamePanel>;
}
