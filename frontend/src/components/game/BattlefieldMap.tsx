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
  { id: "ally_base", label: "Player Base", x: 11, y: 88, w: 18, h: 11 },
  { id: "enemy_base", label: "Enemy Base", x: 88, y: 11, w: 18, h: 11 },
  { id: "exp_lane", label: "EXP", x: 19, y: 12, w: 15, h: 8 },
  { id: "mid_lane", label: "MID", x: 50, y: 50, w: 13, h: 8 },
  { id: "gold_lane", label: "GOLD", x: 81, y: 88, w: 15, h: 8 },
  { id: "ally_blue", label: "Ally Blue", x: 31, y: 67 },
  { id: "ally_red", label: "Ally Red", x: 43, y: 78 },
  { id: "enemy_blue", label: "Enemy Blue", x: 59, y: 22 },
  { id: "enemy_red", label: "Enemy Red", x: 71, y: 34 },
  { id: "river_exp", label: "River", x: 36, y: 35 },
  { id: "river_gold", label: "River", x: 64, y: 65 },
  { id: "objective_pit", label: "Turtle/Lord", x: 57, y: 58, w: 17, h: 9 }
];

const statusClass: Record<ZoneStatus, string> = {
  unknown: "border-slate-400/30 bg-slate-800/60 text-slate-200",
  safe: "border-emerald-300/50 bg-emerald-500/20 text-emerald-100",
  danger: "border-red-300/60 bg-red-500/25 text-red-100",
  contested: "border-orange-300/60 bg-orange-500/25 text-orange-100",
  objective: "border-cyan-300/60 bg-cyan-500/25 text-cyan-100"
};

const turretPoints = [
  [12, 82, "A"], [22, 74, "I"], [34, 63, "O"],
  [88, 18, "A"], [78, 26, "I"], [66, 37, "O"],
  [11, 29, "O"], [27, 36, "I"], [41, 44, "A"],
  [89, 71, "O"], [73, 64, "I"], [59, 56, "A"],
  [31, 89, "O"], [43, 78, "I"], [55, 68, "A"],
  [69, 11, "O"], [57, 22, "I"], [45, 32, "A"]
] as const;

const camps = [
  [23, 55], [31, 68], [42, 59], [49, 75], [58, 24], [67, 35], [76, 48], [44, 25], [29, 32], [66, 73]
] as const;

const wallPaths = [
  "M21 10 C15 10 12 16 16 20 C20 24 26 19 23 15 C25 13 28 12 31 13",
  "M34 7 C40 7 46 7 52 8 C51 12 47 13 43 13 C39 13 36 12 34 7",
  "M62 10 C68 9 75 11 79 15 C74 17 70 17 67 15 C64 13 62 13 62 10",
  "M13 31 C17 29 22 28 26 31 C25 36 20 39 16 37 C13 35 12 33 13 31",
  "M36 26 C42 20 51 22 56 27 C53 32 47 35 42 34 C38 33 35 30 36 26",
  "M72 28 C77 26 83 28 86 32 C83 37 76 38 72 35 C70 32 70 30 72 28",
  "M18 55 C23 51 30 52 34 57 C31 63 23 65 18 61 C16 59 16 57 18 55",
  "M40 70 C47 67 55 69 59 75 C54 80 45 81 40 76 C38 73 38 72 40 70",
  "M65 59 C71 55 79 56 83 62 C80 69 71 71 66 66 C63 64 63 61 65 59",
  "M70 83 C78 83 85 81 91 76 C94 80 93 86 88 90 C81 94 73 91 70 83",
  "M27 43 C33 41 37 43 39 48 C35 51 29 51 25 48 C24 46 25 44 27 43",
  "M55 41 C60 38 66 40 68 45 C64 49 58 50 54 47 C52 45 53 43 55 41"
];

function getStatus(states: MapZoneState[] | undefined, id: MapZoneId): ZoneStatus {
  return states?.find((zone) => zone.id === id)?.status ?? (id === "objective_pit" ? "objective" : "unknown");
}

export function BattlefieldMap({ states, onZoneClick, compact = false }: { states?: MapZoneState[]; onZoneClick?: (id: MapZoneId) => void; compact?: boolean }) {
  return <div className={`relative mx-auto aspect-square w-full max-w-[680px] overflow-hidden rounded-lg border border-white/10 bg-[#162a2f] ${compact ? "min-h-64" : ""}`}>
    <div className="absolute inset-0 bg-[radial-gradient(circle_at_12%_88%,rgba(14,116,144,.65),transparent_24%),radial-gradient(circle_at_89%_12%,rgba(127,29,29,.58),transparent_25%),linear-gradient(135deg,#24434b,#5f7377_48%,#40565b)]" />

    <svg className="absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none">
      <path d="M3 19 L19 3 L67 3 C69 13 72 23 79 31 L97 49 L97 81 L81 97 L33 97 C31 87 28 77 21 69 L3 51 Z" fill="rgba(114,135,140,.55)" stroke="rgba(180,218,225,.28)" strokeWidth="0.8" />

      <path d="M0 25 L25 0" stroke="rgba(174,211,219,.5)" strokeWidth="5" strokeLinecap="round" />
      <path d="M75 100 L100 75" stroke="rgba(174,211,219,.5)" strokeWidth="5" strokeLinecap="round" />
      <path d="M3 67 C17 68 27 76 33 96" fill="rgba(14,91,137,.65)" stroke="rgba(14,42,58,.75)" strokeWidth="0.8" />
      <path d="M67 4 C73 24 83 32 97 33 L97 0 L67 0 Z" fill="rgba(112,39,43,.62)" stroke="rgba(52,17,23,.8)" strokeWidth="0.8" />

      <path d="M3 23 L3 63" stroke="rgba(170,235,245,.45)" strokeWidth="3.1" strokeLinecap="round" />
      <path d="M37 3 L72 3" stroke="rgba(170,235,245,.42)" strokeWidth="2.5" strokeLinecap="round" />
      <path d="M97 41 L97 74" stroke="rgba(170,235,245,.42)" strokeWidth="2.8" strokeLinecap="round" />
      <path d="M39 97 L74 97" stroke="rgba(170,235,245,.42)" strokeWidth="2.5" strokeLinecap="round" />

      <path d="M20 84 L84 20" stroke="rgba(173,234,247,.55)" strokeWidth="4.8" strokeLinecap="round" />
      <path d="M20 84 L84 20" stroke="rgba(29,97,111,.78)" strokeWidth="2.4" strokeLinecap="round" />
      <path d="M24 80 L80 24" stroke="rgba(139,222,240,.72)" strokeWidth="0.9" strokeLinecap="round" />

      <circle cx="35" cy="30" r="10.5" fill="rgba(5,136,157,.8)" />
      <path d="M39 26 C33 22 27 27 30 34 C34 42 46 38 45 29" fill="none" stroke="rgba(9,36,45,.9)" strokeWidth="4" strokeLinecap="round" />
      <circle cx="66" cy="68" r="10.5" fill="rgba(5,136,157,.8)" />
      <path d="M70 64 C64 60 58 65 61 72 C65 80 77 76 76 67" fill="none" stroke="rgba(9,36,45,.9)" strokeWidth="4" strokeLinecap="round" />
      <path d="M45 52 C49 47 54 47 58 52 C54 57 49 57 45 52 Z" fill="rgba(8,135,154,.9)" />

      {wallPaths.map((path) => <path key={path} d={path} fill="none" stroke="rgba(12,31,39,.88)" strokeWidth="5.2" strokeLinecap="round" />)}
      {wallPaths.map((path) => <path key={`${path}-cap`} d={path} fill="none" stroke="rgba(113,141,148,.75)" strokeWidth="1.3" strokeLinecap="round" strokeDasharray="10 18" />)}

      {[18, 45, 73].map((x) => <path key={`rune-top-${x}`} d={`M${x} 7 l3 4 l-3 4 l-3 -4 z`} fill="none" stroke="rgba(151,232,245,.55)" strokeWidth="1" />)}
      {[16, 48, 82].map((y) => <path key={`rune-side-${y}`} d={`M94 ${y} l3 4 l-3 4 l-3 -4 z`} fill="none" stroke="rgba(151,232,245,.55)" strokeWidth="1" />)}
      {[43, 72].map((x) => <path key={`rune-bottom-${x}`} d={`M${x} 93 l4 3 l-4 3 l-4 -3 z`} fill="none" stroke="rgba(151,232,245,.55)" strokeWidth="1" />)}
    </svg>

    {camps.map(([x, y], index) => <div key={`${x}-${y}`} className="absolute h-3.5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-slate-300/35 shadow-[0_0_10px_rgba(186,230,253,.22)]" style={{ left: `${x}%`, top: `${y}%` }} title={`Jungle camp ${index + 1}`} />)}
    {turretPoints.map(([x, y, tier]) => <div key={`${x}-${y}-${tier}`} className="absolute grid h-6 w-6 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-md border border-cyan-200/35 bg-cyan-300/12 text-[9px] font-black text-cyan-50 shadow-[0_0_10px_rgba(125,211,252,.18)]" style={{ left: `${x}%`, top: `${y}%` }} title={`${tier} turret`}>{tier}</div>)}

    <div className="absolute left-0 top-[66%] h-[34%] w-[34%] rounded-tr-full border-r-2 border-t-2 border-cyan-300/25 bg-cyan-700/25" />
    <div className="absolute right-0 top-0 h-[34%] w-[34%] rounded-bl-full border-b-2 border-l-2 border-red-300/20 bg-red-900/28" />
    <div className="absolute left-[42%] top-[42%] h-[16%] w-[16%] rounded-[38%] border border-cyan-100/20 bg-cyan-400/18" />

    {zones.map((zone) => {
      const status = getStatus(states, zone.id);
      return <button key={zone.id} onClick={() => onZoneClick?.(zone.id)} className={`absolute min-h-9 -translate-x-1/2 -translate-y-1/2 rounded-lg border px-2 py-1 text-[10px] font-black backdrop-blur sm:text-xs ${statusClass[status]}`} style={{ left: `${zone.x}%`, top: `${zone.y}%`, width: zone.w ? `${zone.w}%` : undefined, height: zone.h ? `${zone.h}%` : undefined }} title={zone.label}>
        {zone.label}
      </button>;
    })}
  </div>;
}
