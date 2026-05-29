import { DETECTED_FACT_CONFIDENCE } from "../state/matchState.js";

type Point = [number, number];
type MarkerInput = {
  side: "ally" | "enemy";
  minimap: Point;
  confidence: number;
  markerClass: string;
  heroId?: number;
  heroName?: string;
  heroIcon?: string;
  identityConfidence?: number;
  identitySource?: "minimap-hero-identity";
};
type MapObjectInput = {
  objectType: "turtle" | "lord" | "ally_turret" | "enemy_turret";
  minimap: Point;
  confidence: number;
};

export type MonitoredMarker = MarkerInput & {
  id: string;
  status: "visible" | "last_seen";
  lastSeenAt: number;
  ageMs: number;
};
export type MonitoredMapObject = MapObjectInput & {
  id: string;
  status: "visible" | "last_seen";
  lastSeenAt: number;
  ageMs: number;
};
export type MinimapMonitorSnapshot = {
  markers: MonitoredMarker[];
  objects: MonitoredMapObject[];
  visibleAllies: number;
  visibleEnemies: number;
  lastSeenEnemies: number;
  visibleObjectives: Array<"turtle" | "lord">;
  updatedAt: string;
};

const enemyLastSeenMs = 4500;
const objectiveLastSeenMs = 3500;
const turretLastSeenMs = 12000;
const associationDistance = 0.14;
let markerSequence = 0;
let objectSequence = 0;
let markerMemory: MonitoredMarker[] = [];
let objectMemory: MonitoredMapObject[] = [];

export function resetMinimapMonitor() {
  markerSequence = 0;
  objectSequence = 0;
  markerMemory = [];
  objectMemory = [];
}

export function updateMinimapMonitor(input: {
  screen: string;
  timestamp: number;
  markers?: MarkerInput[];
  objects?: MapObjectInput[];
}): MinimapMonitorSnapshot {
  const timestamp = Number.isFinite(input.timestamp) ? input.timestamp : Date.now();
  if (["draft", "lobby", "loading"].includes(input.screen)) {
    resetMinimapMonitor();
    return buildSnapshot([], [], timestamp);
  }
  const visibleMarkers = (input.markers ?? [])
    .filter((marker) => marker.confidence >= DETECTED_FACT_CONFIDENCE)
    .map((marker) => visibleMarker(marker, timestamp));
  const rememberedEnemies = markerMemory
    .filter((marker) => marker.side === "enemy" && !matchedMarker(marker, visibleMarkers))
    .map((marker) => lastSeenMarker(marker, timestamp))
    .filter((marker): marker is MonitoredMarker => Boolean(marker));
  markerMemory = [...visibleMarkers, ...rememberedEnemies];

  const visibleObjects = (input.objects ?? [])
    .filter((object) => object.confidence >= DETECTED_FACT_CONFIDENCE)
    .map((object) => visibleObject(object, timestamp));
  const rememberedObjects = objectMemory
    .filter((object) => !matchedObject(object, visibleObjects))
    .map((object) => lastSeenObject(object, timestamp))
    .filter((object): object is MonitoredMapObject => Boolean(object));
  objectMemory = [...visibleObjects, ...rememberedObjects];

  return buildSnapshot(markerMemory, objectMemory, timestamp);
}

function visibleMarker(marker: MarkerInput, timestamp: number): MonitoredMarker {
  const matching = closestMarker(marker, markerMemory);
  return {
    ...matching,
    ...marker,
    id: matching?.id ?? `map-marker-${marker.side}-${++markerSequence}`,
    status: "visible",
    lastSeenAt: timestamp,
    ageMs: 0,
  };
}

function visibleObject(object: MapObjectInput, timestamp: number): MonitoredMapObject {
  const matching = closestObject(object, objectMemory);
  return {
    ...object,
    id: matching?.id ?? `map-object-${object.objectType}-${++objectSequence}`,
    status: "visible",
    lastSeenAt: timestamp,
    ageMs: 0,
  };
}

function lastSeenMarker(marker: MonitoredMarker, timestamp: number): MonitoredMarker | null {
  const ageMs = Math.max(0, timestamp - marker.lastSeenAt);
  if (ageMs > enemyLastSeenMs) return null;
  return {
    ...marker,
    status: "last_seen",
    confidence: decay(marker.confidence, ageMs, enemyLastSeenMs),
    ageMs,
  };
}

function lastSeenObject(object: MonitoredMapObject, timestamp: number): MonitoredMapObject | null {
  const retentionMs = object.objectType.endsWith("_turret") ? turretLastSeenMs : objectiveLastSeenMs;
  const ageMs = Math.max(0, timestamp - object.lastSeenAt);
  if (ageMs > retentionMs) return null;
  return {
    ...object,
    status: "last_seen",
    confidence: decay(object.confidence, ageMs, retentionMs),
    ageMs,
  };
}

function buildSnapshot(markers: MonitoredMarker[], objects: MonitoredMapObject[], timestamp: number): MinimapMonitorSnapshot {
  return {
    markers,
    objects,
    visibleAllies: markers.filter((marker) => marker.status === "visible" && marker.side === "ally").length,
    visibleEnemies: markers.filter((marker) => marker.status === "visible" && marker.side === "enemy").length,
    lastSeenEnemies: markers.filter((marker) => marker.status === "last_seen" && marker.side === "enemy").length,
    visibleObjectives: objects
      .filter((object) => object.status === "visible" && (object.objectType === "turtle" || object.objectType === "lord"))
      .map((object) => object.objectType as "turtle" | "lord"),
    updatedAt: new Date(timestamp).toISOString(),
  };
}

function closestMarker(marker: MarkerInput, candidates: MonitoredMarker[]) {
  return closest(marker.minimap, candidates.filter((candidate) => candidate.side === marker.side));
}

function closestObject(object: MapObjectInput, candidates: MonitoredMapObject[]) {
  return closest(object.minimap, candidates.filter((candidate) => candidate.objectType === object.objectType));
}

function closest<T extends { minimap: Point }>(point: Point, candidates: T[]) {
  const ranked = candidates.map((candidate) => ({ candidate, distance: distance(point, candidate.minimap) }))
    .sort((left, right) => left.distance - right.distance);
  return ranked[0] && ranked[0].distance <= associationDistance ? ranked[0].candidate : null;
}

function matchedMarker(previous: MonitoredMarker, current: MonitoredMarker[]) {
  return current.some((marker) => marker.id === previous.id);
}

function matchedObject(previous: MonitoredMapObject, current: MonitoredMapObject[]) {
  return current.some((object) => object.id === previous.id);
}

function distance(left: Point, right: Point) {
  return Math.hypot(left[0] - right[0], left[1] - right[1]);
}

function decay(confidence: number, ageMs: number, lifetimeMs: number) {
  return Math.max(0, Math.min(1, confidence * (1 - ageMs / lifetimeMs * 0.45)));
}
