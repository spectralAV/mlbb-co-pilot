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

const turretPoints = [
  [18, 78, "A"], [26, 72, "I"], [35, 65, "O"],
  [80, 22, "A"], [72, 28, "I"], [63, 35, "O"],
  [17, 33, "O"], [29, 38, "I"], [41, 43, "A"],
  [83, 67, "O"], [72, 62, "I"], [60, 57, "A"],
  [33, 84, "O"], [44, 74, "I"], [55, 65, "A"],
  [67, 16, "O"], [57, 26, "I"], [48, 36, "A"]
] as const;

const camps = [
  [25, 52], [31, 67], [42, 61], [49, 75], [59, 29], [67, 36], [73, 49], [55, 22], [37, 30], [62, 70]
] as const;

function getStatus(states: MapZoneState[] | undefined, id: MapZoneId): ZoneStatus {
  return states?.find((zone) => zone.id === id)?.status ?? (id === "objective_pit" ? "objective" : "unknown");
}

export function BattlefieldMap({ states, onZoneClick, compact = false }: { states?: MapZoneState[]; onZoneClick?: (id: MapZoneId) => void; compact?: boolean }) {
  return <div className={`relative aspect-[16/9] w-full overflow-hidden rounded-lg border border-white/10 bg-[#0a1420] ${compact ? "min-h-64" : ""}`}>
    <div className="absolute inset-0 bg-[radial-gradient(circle_at_18%_80%,rgba(14,165,233,.28),transparent_22%),radial-gradient(circle_at_82%_18%,rgba(239,68,68,.26),transparent_22%),linear-gradient(135deg,rgba(12,80,60,.8),rgba(20,83,45,.55)_45%,rgba(30,64,80,.68)_62%,rgba(12,60,50,.8))]" />
    <div className="absolute inset-[6%] rounded-[18%] border border-emerald-200/10 bg-[radial-gradient(circle_at_50%_50%,rgba(34,197,94,.22),transparent_42%)]" />

    <svg className="absolute inset-0 h-full w-full" viewBox="0 0 100 56.25" preserveAspectRatio="none">
      <path d="M11 45 C24 34 33 23 47 8 C58 2 76 4 90 8" stroke="rgba(226,232,240,.45)" strokeWidth="1.2" fill="none" />
      <path d="M8 48 C28 43 41 35 51 28 C61 21 73 13 92 8" stroke="rgba(226,232,240,.60)" strokeWidth="1.55" fill="none" />
      <path d="M10 50 C25 50 40 48 55 43 C71 37 81 31 91 18" stroke="rgba(226,232,240,.45)" strokeWidth="1.2" fill="none" />
      <path d="M29 8 C35 19 43 28 51 28 C59 28 67 37 74 48" stroke="rgba(14,165,233,.25)" strokeWidth="3" fill="none" />
      <path d="M25 47 C35 38 46 31 51 28 C58 23 65 18 75 10" stroke="rgba(14,165,233,.18)" strokeWidth="4" fill="none" />
    </svg>

    {camps.map(([x, y], index) => <div key={`${x}-${y}`} className="absolute h-4 w-6 -translate-x-1/2 -translate-y-1/2 rounded-full bg-stone-500/55 shadow-[0_0_14px_rgba(120,113,108,.35)]" style={{ left: `${x}%`, top: `${y}%` }} title={`Jungle camp ${index + 1}`} />)}
    {turretPoints.map(([x, y, tier]) => <div key={`${x}-${y}-${tier}`} className="absolute grid h-7 w-7 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-md border border-yellow-300/40 bg-yellow-500/15 text-[10px] font-black text-yellow-100" style={{ left: `${x}%`, top: `${y}%` }} title={`${tier} turret`}>{tier}</div>)}

    <div className="absolute left-[8%] top-[78%] h-[14%] w-[13%] rounded-lg border border-cyan-300/40 bg-cyan-500/20" />
    <div className="absolute left-[79%] top-[8%] h-[14%] w-[13%] rounded-lg border border-red-300/40 bg-red-500/20" />
    <div className="absolute left-[48%] top-[46%] h-[16%] w-[20%] rounded-[50%] border border-cyan-200/30 bg-cyan-500/10" />

    {zones.map((zone) => {
      const status = getStatus(states, zone.id);
      return <button key={zone.id} onClick={() => onZoneClick?.(zone.id)} className={`absolute min-h-9 -translate-x-1/2 -translate-y-1/2 rounded-lg border px-2 py-1 text-[10px] font-black backdrop-blur sm:text-xs ${statusClass[status]}`} style={{ left: `${zone.x}%`, top: `${zone.y}%`, width: zone.w ? `${zone.w}%` : undefined, height: zone.h ? `${zone.h}%` : undefined }} title={zone.label}>
        {zone.label}
      </button>;
    })}
  </div>;
}
