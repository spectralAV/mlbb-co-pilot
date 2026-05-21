import { ChevronRight, Map, Route } from "lucide-react";
import type { GameState, MapZoneId, ZoneStatus } from "../../lib/gameTypes";
import { GamePanel, RiskBadge } from "./GameShell";
import { BattlefieldMap } from "./BattlefieldMap";

const nextStatus: Record<ZoneStatus, ZoneStatus> = {
  unknown: "safe",
  safe: "danger",
  danger: "contested",
  contested: "objective",
  objective: "unknown"
};

export function MiniMapControl({ state, onChange }: { state: GameState; onChange: (patch: Partial<GameState>) => void }) {
  function cycle(id: MapZoneId) {
    onChange({
      mapZones: state.mapZones.map((zone) => zone.id === id ? { ...zone, status: nextStatus[zone.status], lastUpdatedAt: Date.now() } : zone)
    });
  }

  return <GamePanel title="Tactical Map Control" icon={Map}>
    <div className="relative">
      <BattlefieldMap states={state.mapZones} onZoneClick={cycle} />
      <div className="pointer-events-none absolute bottom-[18%] left-[24%] flex items-center text-[11px] font-bold text-cyan-100 sm:text-xs">
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
