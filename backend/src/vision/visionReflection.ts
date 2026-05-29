import { cache } from "../services/cacheService.js";

export type VisionReflectionOutcome = "accepted" | "rejected" | "failed";

export type VisionReflectionEntry = {
  id: string;
  category: "live_vision" | "ultralytics";
  outcome: VisionReflectionOutcome;
  source: string;
  reason: string;
  timestamp: number;
  recordedAt: string;
  screen?: string;
  confidence?: number;
  detectionCount?: number;
  markerCount?: number;
  objectCount?: number;
  timerFactCount?: number;
  screenTextFactCount?: number;
  labels: string[];
  metadata: Record<string, unknown>;
};

export type VisionReflectionInput = {
  category: VisionReflectionEntry["category"];
  outcome: VisionReflectionOutcome;
  source?: string;
  reason: string;
  timestamp?: number;
  screen?: string;
  confidence?: number;
  detectionCount?: number;
  markerCount?: number;
  objectCount?: number;
  timerFactCount?: number;
  screenTextFactCount?: number;
  labels?: string[];
  metadata?: Record<string, unknown>;
};

const reflectionFile = "vision-reflections.json";
const maxReflections = 300;
let reflections: VisionReflectionEntry[] | null = null;
let operationChain: Promise<unknown> = Promise.resolve();

export function recordVisionReflection(input: VisionReflectionInput) {
  const entry = normalizeReflection(input);
  const operation = operationChain
    .catch(() => undefined)
    .then(async () => {
      const entries = await loadReflections();
      entries.push(entry);
      reflections = entries.slice(-maxReflections);
      await cache.write(reflectionFile, reflections);
      return entry;
    });
  operationChain = operation.then(() => undefined, () => undefined);
  return operation;
}

export async function getVisionReflections(limit = 50) {
  await flushVisionReflections();
  const entries = await loadReflections();
  return entries.slice(-normalizeLimit(limit)).reverse();
}

export async function getVisionReflectionSummary(limit = 50) {
  await flushVisionReflections();
  const entries = await loadReflections();
  const recent = entries.slice(-normalizeLimit(limit)).reverse();
  const byOutcome = countBy(entries, (entry) => entry.outcome);
  const bySource = countBy(entries, (entry) => entry.source);
  const byReason = countBy(entries, (entry) => entry.reason);
  return {
    total: entries.length,
    byOutcome,
    bySource,
    topReasons: Object.entries(byReason)
      .sort((left, right) => right[1] - left[1])
      .slice(0, 10)
      .map(([reason, count]) => ({ reason, count })),
    recent,
    updatedAt: entries.at(-1)?.recordedAt ?? null,
  };
}

export async function resetVisionReflections() {
  const operation = operationChain
    .catch(() => undefined)
    .then(async () => {
      reflections = [];
      await cache.write(reflectionFile, reflections);
    });
  operationChain = operation;
  await operation;
}

export async function flushVisionReflections() {
  await operationChain.catch(() => undefined);
}

async function loadReflections() {
  if (reflections) return reflections;
  const loaded = await cache.read<VisionReflectionEntry[]>(reflectionFile, []);
  reflections = Array.isArray(loaded) ? loaded.map(normalizeStoredReflection).filter(Boolean) as VisionReflectionEntry[] : [];
  return reflections;
}

function normalizeReflection(input: VisionReflectionInput): VisionReflectionEntry {
  const now = Number.isFinite(Number(input.timestamp)) ? Number(input.timestamp) : Date.now();
  return {
    id: `${now}-${Math.random().toString(36).slice(2, 10)}`,
    category: input.category === "ultralytics" ? "ultralytics" : "live_vision",
    outcome: normalizeOutcome(input.outcome),
    source: String(input.source ?? "unknown"),
    reason: String(input.reason || "unspecified"),
    timestamp: now,
    recordedAt: new Date().toISOString(),
    screen: input.screen ? String(input.screen) : undefined,
    confidence: optionalNumber(input.confidence),
    detectionCount: optionalNumber(input.detectionCount),
    markerCount: optionalNumber(input.markerCount),
    objectCount: optionalNumber(input.objectCount),
    timerFactCount: optionalNumber(input.timerFactCount),
    screenTextFactCount: optionalNumber(input.screenTextFactCount),
    labels: normalizeLabels(input.labels),
    metadata: input.metadata && typeof input.metadata === "object" ? input.metadata : {},
  };
}

function normalizeStoredReflection(entry: any): VisionReflectionEntry | null {
  if (!entry || typeof entry !== "object") return null;
  return {
    id: String(entry.id ?? `${entry.timestamp ?? Date.now()}-stored`),
    category: entry.category === "ultralytics" ? "ultralytics" : "live_vision",
    outcome: normalizeOutcome(entry.outcome),
    source: String(entry.source ?? "unknown"),
    reason: String(entry.reason ?? "unspecified"),
    timestamp: Number.isFinite(Number(entry.timestamp)) ? Number(entry.timestamp) : Date.now(),
    recordedAt: String(entry.recordedAt ?? new Date().toISOString()),
    screen: entry.screen ? String(entry.screen) : undefined,
    confidence: optionalNumber(entry.confidence),
    detectionCount: optionalNumber(entry.detectionCount),
    markerCount: optionalNumber(entry.markerCount),
    objectCount: optionalNumber(entry.objectCount),
    timerFactCount: optionalNumber(entry.timerFactCount),
    screenTextFactCount: optionalNumber(entry.screenTextFactCount),
    labels: normalizeLabels(entry.labels),
    metadata: entry.metadata && typeof entry.metadata === "object" ? entry.metadata : {},
  };
}

function normalizeOutcome(value: unknown): VisionReflectionOutcome {
  return value === "accepted" || value === "failed" ? value : "rejected";
}

function normalizeLabels(value: unknown) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(String).map((label) => label.trim()).filter(Boolean))].slice(0, 20);
}

function normalizeLimit(value: number) {
  const limit = Number(value);
  return Number.isFinite(limit) ? Math.max(1, Math.min(200, Math.floor(limit))) : 50;
}

function optionalNumber(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function countBy(entries: VisionReflectionEntry[], key: (entry: VisionReflectionEntry) => string) {
  return entries.reduce<Record<string, number>>((counts, entry) => {
    const value = key(entry);
    counts[value] = (counts[value] ?? 0) + 1;
    return counts;
  }, {});
}
