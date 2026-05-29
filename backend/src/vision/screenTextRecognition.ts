import { execFile } from "node:child_process";
import { access, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { nanoid } from "nanoid";
import sharp from "sharp";

const execFileAsync = promisify(execFile);
const projectRoot = path.resolve(process.cwd(), "..");
const cvRoot = path.join(projectRoot, "data", "cv");
const managedPython = path.join(cvRoot, ".venv", "Scripts", "python.exe");
const script = path.join(projectRoot, "backend", "tools", "screenOcr.py");
const queryRoot = path.join(cvRoot, "screen-ocr", "queries");
const ocrIntervalMs = 3000;

export const defaultScreenOcrRegions = [
  { key: "top_hud", rect: [0.32, 0, 0.36, 0.08] },
  { key: "kill_feed", rect: [0.3, 0.08, 0.4, 0.18] },
  { key: "scoreboard_modal", rect: [0.1, 0.13, 0.8, 0.78] },
  { key: "draft_header", rect: [0.25, 0, 0.5, 0.12] },
  { key: "result_banner", rect: [0.24, 0.14, 0.52, 0.2] },
] as const;

export type ScreenOcrRegion = {
  key: string;
  rect: [number, number, number, number];
};

export type ScreenTextCandidate = {
  text: string;
  confidence: number;
  bbox?: unknown;
};

export type ScreenTextFact = {
  region: string;
  text: string;
  confidence: number;
  rect: [number, number, number, number];
  words: ScreenTextCandidate[];
  source: "paddleocr-screen";
  observedAt: number;
};

type InferOptions = {
  regions?: unknown;
  maxRegions?: number;
  observedAt?: number;
};

let lastInferenceAt = 0;

export async function getScreenOcrStatus() {
  const tool = await runScreenOcr(["status"]).catch(() => ({
    engine: "paddleocr-screen",
    packageAvailable: false,
    paddleAvailable: false,
    defaultRegions: defaultScreenOcrRegions,
  }));
  return {
    ...tool,
    enabledForLiveCapture: isScreenOcrLiveEnabled(),
    throttleMs: ocrIntervalMs,
  };
}

export async function installScreenOcrRuntime() {
  if (!(await exists(managedPython))) throw new Error("Install the managed CV runtime before PaddleOCR.");
  await execFileAsync(managedPython, [
    "-m", "pip", "install", "--disable-pip-version-check", "paddlepaddle>=3,<4", "paddleocr>=3,<4",
  ], {
    timeout: 30 * 60 * 1000,
    windowsHide: true,
    maxBuffer: 32 * 1024 * 1024,
  });
  return getScreenOcrStatus();
}

export async function inferScreenTextFrame(image: Buffer, options: InferOptions = {}) {
  await mkdir(queryRoot, { recursive: true });
  const file = path.join(queryRoot, `${nanoid(10)}.png`);
  const regions = normalizeScreenOcrRegions(options.regions).slice(0, Math.max(1, Math.min(8, Number(options.maxRegions ?? 8))));
  await sharp(image).png().toFile(file);
  try {
    const result = await runScreenOcr([
      "infer",
      "--image", file,
      "--regions-json", JSON.stringify(regions),
    ], 180000);
    return {
      engine: String(result.engine ?? "paddleocr-screen"),
      regions: normalizeScreenTextFacts(result.regions, Number(options.observedAt ?? Date.now())),
    };
  } finally {
    await rm(file, { force: true });
  }
}

export async function recognizeScreenTextFrame(image: Buffer, options: InferOptions = {}) {
  const now = Number(options.observedAt ?? Date.now());
  if (!isScreenOcrLiveEnabled() || now - lastInferenceAt < ocrIntervalMs) return [] as ScreenTextFact[];
  lastInferenceAt = now;
  const result = await inferScreenTextFrame(image, { ...options, observedAt: now });
  return result.regions.filter((fact) => fact.text && fact.confidence >= 0.45);
}

export function resetScreenTextRecognition() {
  lastInferenceAt = 0;
}

export function isScreenOcrLiveEnabled() {
  return /^(1|true|yes)$/i.test(String(process.env.MLBB_ENABLE_SCREEN_OCR ?? ""));
}

export function normalizeScreenOcrRegions(value: unknown): ScreenOcrRegion[] {
  const direct = normalizeRegionList(value);
  if (direct.length) return direct;
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const mapped = Object.entries(value as Record<string, unknown>)
      .flatMap(([key, region]) => {
        const rect = firstRect(region);
        return rect ? [{ key: normalizeRegionKey(key), rect }] : [];
      });
    if (mapped.length) return mapped.slice(0, 8);
  }
  return defaultScreenOcrRegions.map((region) => ({ key: region.key, rect: [...region.rect] as ScreenOcrRegion["rect"] }));
}

export function normalizeScreenTextFacts(value: unknown, observedAt = Date.now()): ScreenTextFact[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((fact: any) => {
      const rect = firstRect(fact?.rect);
      const words = normalizeCandidates(fact?.candidates);
      return {
        region: normalizeRegionKey(fact?.key ?? fact?.region ?? "screen"),
        text: normalizeOcrText(fact?.text),
        confidence: clamp01(fact?.confidence),
        rect,
        words,
        source: "paddleocr-screen" as const,
        observedAt,
      };
    })
    .filter((fact): fact is ScreenTextFact => Boolean(fact.region) && fact.rect !== null)
    .slice(0, 8);
}

function normalizeRegionList(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item: any, index) => {
      const rect = firstRect(item?.rect ?? item);
      return rect ? { key: normalizeRegionKey(item?.key ?? `region_${index}`), rect } : null;
    })
    .filter((item): item is ScreenOcrRegion => item !== null)
    .slice(0, 8);
}

function normalizeCandidates(value: unknown): ScreenTextCandidate[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item: any) => ({
      text: normalizeOcrText(item?.text),
      confidence: clamp01(item?.confidence),
      bbox: item?.bbox,
    }))
    .filter((item) => item.text)
    .slice(0, 16);
}

function normalizeRegionKey(value: unknown) {
  const key = String(value ?? "screen")
    .trim()
    .toLowerCase()
    .replace(/_norm$/, "")
    .replace(/[^a-z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (key === "scoreboard") return "top_hud";
  if (key === "equipment_window" || key === "attributes_window") return "scoreboard_modal";
  return key || "screen";
}

function normalizeOcrText(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, 240);
}

function firstRect(value: unknown): [number, number, number, number] | null {
  if (isRect(value)) return value;
  if (Array.isArray(value)) {
    for (const item of value) {
      const rect = firstRect(item);
      if (rect) return rect;
    }
  }
  return null;
}

function isRect(value: unknown): value is [number, number, number, number] {
  return Array.isArray(value)
    && value.length === 4
    && value.every((coordinate) => typeof coordinate === "number" && Number.isFinite(coordinate) && coordinate >= 0 && coordinate <= 1);
}

function clamp01(value: unknown) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.min(1, number));
}

async function runScreenOcr(args: string[], timeout = 30000) {
  if (!(await exists(managedPython))) throw new Error("Install the managed CV runtime before OCR.");
  const { stdout } = await execFileAsync(managedPython, [script, ...args, "--project-root", projectRoot], {
    timeout,
    windowsHide: true,
    maxBuffer: 16 * 1024 * 1024,
  });
  const jsonLine = stdout.trim().split(/\r?\n/).reverse().find((line) => line.trim().startsWith("{"));
  if (!jsonLine) throw new Error("Screen OCR returned no structured response.");
  const response = JSON.parse(jsonLine);
  if (!response.ok) throw new Error(response.error ?? "Screen OCR failed.");
  return response.data;
}

async function exists(file: string) {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}
