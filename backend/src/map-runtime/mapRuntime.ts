import fs from "node:fs";
import path from "node:path";

export type MapZone = {
  id: string;
  name: string;
  type: string;
  polygon: number[][];
  drawMode?: "polygon" | "freehand" | "oval";
  dangerWeight: number;
  connectedZones?: string[];
};

type Point = [number, number];

export type MinimapProjection = {
  mode: "bilinear_quad";
  source: "minimap-normalized-square";
  target: "tactical-map-normalized-rhombus";
  minimapCorners: {
    topLeft: Point;
    topRight: Point;
    bottomRight: Point;
    bottomLeft: Point;
  };
  tacticalCorners: {
    topLeft: Point;
    topRight: Point;
    bottomRight: Point;
    bottomLeft: Point;
  };
};

const ROOT = path.resolve(process.cwd(), "..");
const MAP_DIR = path.join(ROOT, "data", "map");
const ZONES_FILE = path.join(MAP_DIR, "map_zones.json");
const PROJECTION_FILE = path.join(MAP_DIR, "minimap_projection.json");

const defaultZones: MapZone[] = [
  { id: "mid-river", name: "Mid River", type: "river", polygon: [[0.40, 0.44], [0.60, 0.44], [0.60, 0.56], [0.40, 0.56]], dangerWeight: 0.7, connectedZones: ["turtle-zone", "lord-zone"] },
  { id: "turtle-zone", name: "Turtle Zone", type: "objective", polygon: [[0.58, 0.55], [0.78, 0.55], [0.78, 0.75], [0.58, 0.75]], dangerWeight: 0.85, connectedZones: ["mid-river"] },
  { id: "lord-zone", name: "Lord Zone", type: "objective", polygon: [[0.22, 0.22], [0.42, 0.22], [0.42, 0.42], [0.22, 0.42]], dangerWeight: 0.9, connectedZones: ["mid-river"] }
];

const defaultProjection: MinimapProjection = {
  mode: "bilinear_quad",
  source: "minimap-normalized-square",
  target: "tactical-map-normalized-rhombus",
  minimapCorners: {
    topLeft: [0, 0],
    topRight: [1, 0],
    bottomRight: [1, 1],
    bottomLeft: [0, 1]
  },
  tacticalCorners: {
    topLeft: [0.18, 0.08],
    topRight: [0.80, 0.10],
    bottomRight: [0.88, 0.88],
    bottomLeft: [0.12, 0.86]
  }
};

function ensureMapDir() {
  fs.mkdirSync(MAP_DIR, { recursive: true });
}

function clamp01(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function normalizePoint(point: unknown, fallback: Point): Point {
  if (!Array.isArray(point) || point.length < 2) return fallback;
  return [clamp01(Number(point[0])), clamp01(Number(point[1]))];
}

function normalizeZone(zone: any, index: number): MapZone | null {
  const polygon = Array.isArray(zone?.polygon)
    ? zone.polygon
        .filter((point: any) => Array.isArray(point) && point.length >= 2)
        .map((point: any) => [Number(point[0]), Number(point[1])])
        .filter((point: number[]) => point.every((value) => Number.isFinite(value) && value >= 0 && value <= 1))
    : [];
  if (polygon.length < 3) return null;
  return {
    id: String(zone?.id ?? `zone-${index + 1}`),
    name: String(zone?.name ?? `Zone ${index + 1}`),
    type: String(zone?.type ?? "semantic"),
    polygon,
    drawMode: zone?.drawMode === "freehand" || zone?.drawMode === "oval" ? zone.drawMode : "polygon",
    dangerWeight: Number.isFinite(Number(zone?.dangerWeight)) ? Number(zone.dangerWeight) : 0.5,
    connectedZones: Array.isArray(zone?.connectedZones) ? zone.connectedZones.map(String) : []
  };
}

export function getZones(): MapZone[] {
  try {
    const data = JSON.parse(fs.readFileSync(ZONES_FILE, "utf8"));
    if (Array.isArray(data)) return data.map(normalizeZone).filter(Boolean) as MapZone[];
  } catch {}
  return defaultZones;
}

export function saveZones(zones: unknown) {
  const next = Array.isArray(zones) ? zones.map(normalizeZone).filter(Boolean) as MapZone[] : [];
  ensureMapDir();
  fs.writeFileSync(ZONES_FILE, JSON.stringify(next, null, 2), "utf8");
  return next;
}

export function getMapRuntimeManifest() {
  const zones = getZones();
  const projection = getMinimapProjection();
  return {
    name: "MLBB Co-Pilot Map Runtime",
    version: "0.1",
    coordinateSystem: "normalized-0-1",
    zones: zones.length,
    projectionMode: projection.mode,
    projectionTarget: projection.target
  };
}

export function mapPointToZone(x: number, y: number) {
  return getZones().find((zone) => pointInPoly([x, y], zone.polygon)) ?? null;
}

export function getMinimapProjection(): MinimapProjection {
  try {
    return normalizeProjection(JSON.parse(fs.readFileSync(PROJECTION_FILE, "utf8")));
  } catch {}
  return defaultProjection;
}

export function saveMinimapProjection(projection: unknown) {
  const next = normalizeProjection(projection);
  ensureMapDir();
  fs.writeFileSync(PROJECTION_FILE, JSON.stringify(next, null, 2), "utf8");
  return next;
}

export function projectMinimapPoint(x: number, y: number, projection = getMinimapProjection()) {
  const u = clamp01(Number(x));
  const v = clamp01(Number(y));
  const { topLeft, topRight, bottomRight, bottomLeft } = projection.tacticalCorners;

  const top: Point = [
    lerp(topLeft[0], topRight[0], u),
    lerp(topLeft[1], topRight[1], u)
  ];
  const bottom: Point = [
    lerp(bottomLeft[0], bottomRight[0], u),
    lerp(bottomLeft[1], bottomRight[1], u)
  ];

  const tactical: Point = [
    clamp01(lerp(top[0], bottom[0], v)),
    clamp01(lerp(top[1], bottom[1], v))
  ];

  return {
    minimap: [u, v] as Point,
    tactical,
    zone: mapPointToZone(tactical[0], tactical[1])
  };
}

function normalizeProjection(projection: any): MinimapProjection {
  const sourceCorners = projection?.minimapCorners ?? {};
  const targetCorners = projection?.tacticalCorners ?? {};
  return {
    mode: "bilinear_quad",
    source: "minimap-normalized-square",
    target: "tactical-map-normalized-rhombus",
    minimapCorners: {
      topLeft: normalizePoint(sourceCorners.topLeft, defaultProjection.minimapCorners.topLeft),
      topRight: normalizePoint(sourceCorners.topRight, defaultProjection.minimapCorners.topRight),
      bottomRight: normalizePoint(sourceCorners.bottomRight, defaultProjection.minimapCorners.bottomRight),
      bottomLeft: normalizePoint(sourceCorners.bottomLeft, defaultProjection.minimapCorners.bottomLeft)
    },
    tacticalCorners: {
      topLeft: normalizePoint(targetCorners.topLeft, defaultProjection.tacticalCorners.topLeft),
      topRight: normalizePoint(targetCorners.topRight, defaultProjection.tacticalCorners.topRight),
      bottomRight: normalizePoint(targetCorners.bottomRight, defaultProjection.tacticalCorners.bottomRight),
      bottomLeft: normalizePoint(targetCorners.bottomLeft, defaultProjection.tacticalCorners.bottomLeft)
    }
  };
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

function pointInPoly(point: number[], poly: number[][]) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
    const intersect = ((yi > point[1]) !== (yj > point[1])) && (point[0] < (xj - xi) * (point[1] - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}
