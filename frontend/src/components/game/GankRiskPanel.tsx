import { AlertTriangle } from "lucide-react";
import type { GankRiskOutput, LaneId } from "../../lib/gameTypes";
import { GamePanel, RiskBadge } from "./GameShell";

const lanes: LaneId[] = ["exp", "mid", "gold"];

export function GankRiskPanel({ risk }: { risk: GankRiskOutput }) {
  return <GamePanel title="Gank Risk" icon={AlertTriangle}>
    <div className="space-y-3">
      {lanes.map((lane) => <div key={lane} className="rounded-lg border border-white/10 bg-slate-950/60 p-3">
        <div className="flex items-center justify-between"><b className="uppercase">{lane}</b><RiskBadge risk={risk.lanes[lane].risk}>{risk.lanes[lane].risk}</RiskBadge></div>
        <div className="mt-2 text-xs text-slate-400">{risk.lanes[lane].reasons[0] ?? "No major pressure signal."}</div>
      </div>)}
    </div>
  </GamePanel>;
}
