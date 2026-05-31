import type { MapZoneId, MapZoneState, ZoneStatus } from "../../lib/gameTypes";

type Point = [number, number];

type MinimapProjectionLike = {
  tacticalCorners?: {
    topLeft?: Point;
    topRight?: Point;
    bottomRight?: Point;
    bottomLeft?: Point;
  };
};

export type TacticalMapMarker = {
  id: string;
  side: "ally" | "enemy";
  markerClass?: "team-color-candidate" | "hero-ring" | "ultralytics-yolo";
  minimap?: Point;
  tactical?: Point;
  heroIcon?: string;
  heroName?: string;
  confidence?: number;
  status?: "visible" | "last_seen";
  ageMs?: number;
};

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
const markerShells = {
  ally: "/assets/map/markers/placeholder-ally.png",
  enemy: "/assets/map/markers/placeholder-enemy.png"
};
const defaultTacticalCorners = {
  topLeft: [0.18, 0.08] as Point,
  topRight: [0.80, 0.10] as Point,
  bottomRight: [0.88, 0.88] as Point,
  bottomLeft: [0.12, 0.86] as Point
};

function getStatus(states: MapZoneState[] | undefined, id: MapZoneId): ZoneStatus {
  return states?.find((zone) => zone.id === id)?.status ?? (id === "objective_pit" ? "objective" : "unknown");
}

export function BattlefieldMap({
  states,
  riskZones,
  markers = [],
  projection,
  onZoneClick,
  compact = false,
  showOverlay = false
}: {
  states?: MapZoneState[];
  riskZones?: Array<{ zone: MapZoneId; risk: "low" | "medium" | "high" | "critical"; reason: string }>;
  markers?: TacticalMapMarker[];
  projection?: MinimapProjectionLike;
  onZoneClick?: (id: MapZoneId) => void;
  compact?: boolean;
  showOverlay?: boolean;
}) {
  const shouldShowOverlay = showOverlay || Boolean(states?.length) || Boolean(onZoneClick);

  return <div className={`game-battlefield-map relative aspect-[2856/1280] w-full overflow-hidden rounded-lg border border-white/10 bg-[#06121a] ${compact ? "min-h-64" : ""}`}>
    <img className="h-full w-full object-cover" src={tacticalMapReference} alt="MLBB tactical map reference" draggable={false} />
    <div className="game-map-vignette" />

    {shouldShowOverlay && zones.map((zone) => {
      const status = getStatus(states, zone.id);
      const riskZone = riskZones?.find((entry) => entry.zone === zone.id);
      return <button key={zone.id} onClick={() => onZoneClick?.(zone.id)} className={`game-map-zone game-map-zone-${status} ${riskZone ? `game-map-zone-risk game-map-zone-risk-${riskZone.risk}` : ""} absolute min-h-8 -translate-x-1/2 -translate-y-1/2 rounded-lg border px-2 py-1 text-[10px] font-black shadow-lg backdrop-blur-sm sm:text-xs ${statusClass[status]}`} style={{ left: `${zone.x}%`, top: `${zone.y}%`, width: zone.w ? `${zone.w}%` : undefined, height: zone.h ? `${zone.h}%` : undefined }} title={riskZone ? `${zone.label}: ${riskZone.reason}` : zone.label}>
        {zone.label}
      </button>;
    })}

    {markers.map((marker) => <TacticalHeroMarker key={marker.id} marker={marker} projection={projection} />)}
  </div>;
}

function TacticalHeroMarker({ marker, projection }: { key?: string; marker: TacticalMapMarker; projection?: MinimapProjectionLike }) {
  const point = marker.tactical ?? (marker.minimap ? projectMinimapPoint(marker.minimap, projection) : null);
  if (!point) return null;
  const shell = markerShells[marker.side];
  const lastSeen = marker.status === "last_seen";
  const label = marker.heroName ?? `${marker.side} ${lastSeen ? "last seen" : "visible"} minimap candidate`;
  return <div
    className={`pointer-events-none absolute z-20 h-14 w-14 -translate-x-1/2 -translate-y-full drop-shadow-[0_7px_10px_rgba(0,0,0,0.55)] sm:h-16 sm:w-16 ${lastSeen ? "opacity-45 grayscale" : ""}`}
    style={{ left: `${point[0] * 100}%`, top: `${point[1] * 100}%` }}
    title={label}
  >
    <img className="relative h-full w-full object-contain" src={shell} alt={label} draggable={false} />
    {marker.heroIcon && <img
      className="absolute left-[18%] top-[6%] h-[58%] w-[64%] rounded-full object-cover"
      src={marker.heroIcon}
      alt=""
      draggable={false}
    />}
    {typeof marker.confidence === "number" && <span className="absolute -right-1 top-1 rounded-full bg-black/70 px-1 text-[9px] font-bold text-white">
      {Math.round(marker.confidence * 100)}
    </span>}
    {lastSeen && <span className="absolute -bottom-2 left-1/2 -translate-x-1/2 whitespace-nowrap border border-amber-300/40 bg-black/80 px-1.5 py-0.5 text-[9px] font-black uppercase text-amber-200">
      Last seen
    </span>}
  </div>;
}

function projectMinimapPoint(point: Point, projection?: MinimapProjectionLike): Point {
  const corners = projection?.tacticalCorners ?? defaultTacticalCorners;
  const topLeft = corners.topLeft ?? defaultTacticalCorners.topLeft;
  const topRight = corners.topRight ?? defaultTacticalCorners.topRight;
  const bottomRight = corners.bottomRight ?? defaultTacticalCorners.bottomRight;
  const bottomLeft = corners.bottomLeft ?? defaultTacticalCorners.bottomLeft;
  const u = clamp01(point[0]);
  const v = clamp01(point[1]);
  const top: Point = [lerp(topLeft[0], topRight[0], u), lerp(topLeft[1], topRight[1], u)];
  const bottom: Point = [lerp(bottomLeft[0], bottomRight[0], u), lerp(bottomLeft[1], bottomRight[1], u)];
  return [clamp01(lerp(top[0], bottom[0], v)), clamp01(lerp(top[1], bottom[1], v))];
}

function clamp01(value: number) {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}
