import { useQuery } from "@tanstack/react-query";
import { apiGet } from "../api/client";
import { BattlefieldMap } from "../components/game/BattlefieldMap";

export function TacticalMap() {
  const map = useQuery({ queryKey: ["map-runtime"], queryFn: () => apiGet<any>("/api/map/runtime") });
  const zones = map.data?.zones ?? [];
  return <div className="space-y-5">
    <div><h2 className="text-3xl font-black">Tactical Map</h2><p className="text-slate-400">Semantic zones and objective control foundation.</p></div>
    <div className="grid gap-4 xl:grid-cols-[minmax(0,725px)_minmax(280px,1fr)]">
      <div className="card p-3 sm:p-4">
        <BattlefieldMap />
      </div>
      <div className="card p-4"><h3 className="mb-3 font-bold">Zones</h3><div className="touch-scroll max-h-[70vh] overflow-auto pr-1">{zones.map((zone: any) => <div className="mb-2 rounded-lg bg-white/5 p-3" key={zone.id}><b>{zone.name}</b><p className="text-xs text-slate-400">{zone.type} / danger {zone.dangerWeight}</p></div>)}</div></div>
    </div>
  </div>;
}
