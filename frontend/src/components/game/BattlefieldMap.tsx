import type { MapZoneId, MapZoneState, ZoneStatus } from "../../lib/gameTypes";

type Zone = {
  id: MapZoneId;
  label: string;
  x: number;
  y: number;
  w?: number;
  h?: number;
};

const zones: Zone[] = [
  { id: "ally_base", label: "Player Base", x: 8, y: 79, w: 13, h: 11 },
  { id: "enemy_base", label: "Enemy Base", x: 79, y: 9, w: 13, h: 11 },
  { id: "exp_lane", label: "EXP", x: 15, y: 19, w: 14, h: 8 },
  { id: "mid_lane", label: "MID", x: 45, y: 49, w: 13, h: 8 },
  { id: "gold_lane", label: "GOLD", x: 74, y: 75, w: 14, h: 8 },
  { id: "ally_blue", label: "Ally Blue", x: 25, y: 61 },
  { id: "ally_red", label: "Ally Red", x: 39, y: 75 },
  { id: "enemy_blue", label: "Enemy Blue", x: 60, y: 24 },
  { id: "enemy_red", label: "Enemy Red", x: 73, y: 38 },
  { id: "river_exp", label: "River", x: 33, y: 35 },
  { id: "river_gold", label: "River", x: 66, y: 62 },
  { id: "objective_pit", label: "Turtle/Lord", x: 55, y: 55, w: 15, h: 9 }
];

const statusClass: Record<ZoneStatus, string> = {
  unknown: "border-slate-400/30 bg-slate-800/60 text-slate-200",
  safe: "border-emerald-300/50 bg-emerald-500/20 text-emerald-100",
  danger: "border-red-300/60 bg-red-500/25 text-red-100",
  contested: "border-orange-300/60 bg-orange-500/25 text-orange-100",
  objective: "border-cyan-300/60 bg-cyan-500/25 text-cyan-100"
};

const tacticalMapReference = "/assets/map/mlbb-tactical-map-reference.png";

function getStatus(states: MapZoneState[] | undefined, id: MapZoneId): ZoneStatus {
  return states?.find((zone) => zone.id === id)?.status ?? (id === "objective_pit" ? "objective" : "unknown");
}

export function BattlefieldMap({
  states,
  onZoneClick,
  compact = false,
  showOverlay = false
}: {
  states?: MapZoneState[];
  onZoneClick?: (id: MapZoneId) => void;
  compact?: boolean;
  showOverlay?: boolean;
}) {
  const shouldShowOverlay = showOverlay || Boolean(states?.length) || Boolean(onZoneClick);

  return <div className={`relative aspect-[2856/1280] w-full overflow-hidden rounded-lg border border-white/10 bg-[#06121a] ${compact ? "min-h-64" : ""}`}>
    <img className="h-full w-full object-cover" src={tacticalMapReference} alt="MLBB tactical map reference" draggable={false} />

    {shouldShowOverlay && zones.map((zone) => {
      const status = getStatus(states, zone.id);
      return <button key={zone.id} onClick={() => onZoneClick?.(zone.id)} className={`absolute min-h-8 -translate-x-1/2 -translate-y-1/2 rounded-lg border px-2 py-1 text-[10px] font-black shadow-lg backdrop-blur-sm sm:text-xs ${statusClass[status]}`} style={{ left: `${zone.x}%`, top: `${zone.y}%`, width: zone.w ? `${zone.w}%` : undefined, height: zone.h ? `${zone.h}%` : undefined }} title={zone.label}>
        {zone.label}
      </button>;
    })}
  </div>;
}
