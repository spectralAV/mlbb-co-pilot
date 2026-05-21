import { ChevronRight, Map, Route } from "lucide-react";
import type { GameState, MapZoneId, ZoneStatus } from "../../lib/gameTypes";
import { GamePanel, RiskBadge } from "./GameShell";

const zones: Array<{ id: MapZoneId; label: string; pos: string }> = [
  { id: "exp_lane", label: "EXP", pos: "left-[7%] top-[8%]" },
  { id: "mid_lane", label: "MID", pos: "left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2" },
  { id: "gold_lane", label: "GOLD", pos: "bottom-[8%] right-[7%]" },
  { id: "objective_pit", label: "TURTLE", pos: "bottom-[28%] left-[24%]" },
  { id: "ally_blue", label: "ALLY BLUE", pos: "bottom-[30%] left-[7%]" },
  { id: "ally_red", label: "ALLY RED", pos: "bottom-[18%] left-[24%]" },
  { id: "enemy_blue", label: "ENEMY BLUE", pos: "top-[18%] right-[24%]" },
  { id: "enemy_red", label: "ENEMY RED", pos: "top-[30%] right-[7%]" },
  { id: "river_exp", label: "RIVER", pos: "top-[32%] left-[36%]" },
  { id: "river_gold", label: "RIVER", pos: "bottom-[32%] right-[36%]" }
];

const statusClass: Record<ZoneStatus, string> = {
  unknown: "border-slate-500/40 bg-slate-700/40 text-slate-200",
  safe: "border-emerald-400/40 bg-emerald-500/15 text-emerald-200",
  danger: "border-red-400/50 bg-red-500/20 text-red-200",
  contested: "border-orange-400/50 bg-orange-500/20 text-orange-200",
  objective: "border-cyan-400/50 bg-cyan-500/20 text-cyan-200"
};

const nextStatus: Record<ZoneStatus, ZoneStatus> = {
  unknown: "safe",
  safe: "danger",
  danger: "contested",
  contested: "objective",
  objective: "unknown"
};

export function MiniMapControl({ state, onChange }: { state: GameState; onChange: (patch: Partial<GameState>) => void }) {
  function status(id: MapZoneId) {
    return state.mapZones.find((zone) => zone.id === id)?.status ?? "unknown";
  }

  function cycle(id: MapZoneId) {
    onChange({
      mapZones: state.mapZones.map((zone) => zone.id === id ? { ...zone, status: nextStatus[zone.status], lastUpdatedAt: Date.now() } : zone)
    });
  }

  return <GamePanel title="Tactical Map Control" icon={Map}>
    <div className="relative h-[300px] overflow-hidden rounded-lg border border-white/10 bg-slate-950 shadow-inner sm:h-[360px] xl:h-[420px]">
      <div className="absolute inset-0 opacity-20 bg-[radial-gradient(circle_at_20%_80%,#22d3ee,transparent_24%),radial-gradient(circle_at_80%_20%,#ef4444,transparent_24%),linear-gradient(135deg,transparent_48%,#64748b_49%,#64748b_51%,transparent_52%)]" />
      <div className="absolute bottom-5 left-5 grid h-20 w-20 place-items-center rounded-lg border border-cyan-400/40 bg-cyan-500/10 text-center text-xs font-bold text-cyan-200">ALLY BASE</div>
      <div className="absolute right-5 top-5 grid h-20 w-20 place-items-center rounded-lg border border-red-400/40 bg-red-500/10 text-center text-xs font-bold text-red-200">ENEMY BASE</div>
      <div className="absolute left-10 right-10 top-1/2 h-1 rotate-[-18deg] bg-slate-600/60" />
      <div className="absolute left-10 right-10 top-1/2 h-1 rotate-[18deg] bg-slate-600/60" />
      <div className="absolute left-10 right-10 top-1/2 h-1 bg-slate-600/60" />
      {zones.map((zone) => <button key={zone.id} title="Click to cycle zone status" className={`absolute ${zone.pos} min-h-10 rounded-lg border px-2 py-2 text-[10px] font-black backdrop-blur sm:px-3 sm:text-xs ${statusClass[status(zone.id)]}`} onClick={() => cycle(zone.id)}>{zone.label}</button>)}
      <div className="absolute bottom-24 left-16 flex items-center text-[11px] font-bold text-cyan-200 sm:bottom-28 sm:left-24 sm:text-xs">
        <Route className="mr-1 h-5 w-5" /> Red to Mid to Turtle <ChevronRight className="h-5 w-5 animate-pulse" />
      </div>
      <div className="absolute bottom-3 right-3 w-44 rounded-lg border border-white/10 bg-slate-900/90 p-3 sm:bottom-4 sm:right-4 sm:w-52">
        <div className="mb-2 text-xs uppercase text-slate-400">Info Confidence</div>
        <div className="h-2 overflow-hidden rounded-full bg-slate-700"><div className="h-full w-[68%] bg-cyan-300" /></div>
        <div className="mt-2 flex items-center justify-between text-xs text-slate-300"><span>68%</span><RiskBadge risk={state.enemyMissing.roam ? "high" : "low"}>{state.enemyMissing.roam ? "roam stale" : "fresh"}</RiskBadge></div>
      </div>
    </div>
  </GamePanel>;
}
