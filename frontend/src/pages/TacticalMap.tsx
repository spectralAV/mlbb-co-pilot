import { useQuery } from "@tanstack/react-query";
import { apiGet } from "../api/client";

export function TacticalMap() {
  const map = useQuery({ queryKey: ["map-runtime"], queryFn: () => apiGet<any>("/api/map/runtime") });
  const zones = map.data?.zones ?? [];
  return <div className="space-y-5">
    <div><h2 className="text-3xl font-black">Tactical Map</h2><p className="text-slate-400">Semantic zones and objective control foundation.</p></div>
    <div className="grid gap-4 xl:grid-cols-[minmax(0,725px)_minmax(280px,1fr)]">
      <div className="card p-3 sm:p-4">
        <svg viewBox="0 0 725 725" className="aspect-square w-full rounded-lg border border-white/10 bg-slate-900">
          <rect width="725" height="725" fill="#0f172a"/>
          <line x1="80" y1="645" x2="645" y2="80" stroke="#334155" strokeWidth="28" opacity=".8"/>
          <line x1="80" y1="80" x2="645" y2="645" stroke="#1e293b" strokeWidth="18" opacity=".8"/>
          <line x1="100" y1="362" x2="625" y2="362" stroke="#475569" strokeWidth="12" opacity=".7"/>
          {zones.map((zone: any) => <polygon key={zone.id} points={zone.polygon.map(([x, y]: [number, number]) => `${x * 725},${y * 725}`).join(" ")} fill="rgba(139,92,246,.2)" stroke="rgba(196,181,253,.8)" strokeWidth="2"/>)}
        </svg>
      </div>
      <div className="card p-4"><h3 className="mb-3 font-bold">Zones</h3><div className="touch-scroll max-h-[70vh] overflow-auto pr-1">{zones.map((zone: any) => <div className="mb-2 rounded-lg bg-white/5 p-3" key={zone.id}><b>{zone.name}</b><p className="text-xs text-slate-400">{zone.type} / danger {zone.dangerWeight}</p></div>)}</div></div>
    </div>
  </div>;
}
