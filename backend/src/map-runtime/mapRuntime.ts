import fs from "node:fs";
import path from "node:path";

export type MapZone = {
  id: string;
  name: string;
  type: string;
  polygon: number[][];
  drawMode?: "polygon" | "freehand";
  dangerWeight: number;
  connectedZones?: string[];
};

const ROOT = path.resolve(process.cwd(), "..");
const MAP_DIR = path.join(ROOT, "data", "map");
const ZONES_FILE = path.join(MAP_DIR, "map_zones.json");

const defaultZones: MapZone[] = [
  { id: "mid-river", name: "Mid River", type: "river", polygon: [[0.40, 0.44], [0.60, 0.44], [0.60, 0.56], [0.40, 0.56]], dangerWeight: 0.7, connectedZones: ["turtle-zone", "lord-zone"] },
  { id: "turtle-zone", name: "Turtle Zone", type: "objective", polygon: [[0.58, 0.55], [0.78, 0.55], [0.78, 0.75], [0.58, 0.75]], dangerWeight: 0.85, connectedZones: ["mid-river"] },
  { id: "lord-zone", name: "Lord Zone", type: "objective", polygon: [[0.22, 0.22], [0.42, 0.22], [0.42, 0.42], [0.22, 0.42]], dangerWeight: 0.9, connectedZones: ["mid-river"] }
];

function ensureMapDir() {
  fs.mkdirSync(MAP_DIR, { recursive: true });
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
    drawMode: zone?.drawMode === "freehand" ? "freehand" : "polygon",
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
  return { name: "MLBB Co-Pilot Map Runtime", version: "0.1", coordinateSystem: "normalized-0-1", zones: zones.length };
}

export function mapPointToZone(x: number, y: number) {
  return getZones().find((zone) => pointInPoly([x, y], zone.polygon)) ?? null;
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
