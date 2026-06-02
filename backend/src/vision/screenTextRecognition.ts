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

const falseOcrReferenceFrame = { width: 1920, height: 1080 };

const mlbbHudOcrPixelRegions = [
  { key: "turret1", x: 665, y: 12, w: 34, h: 36 },
  { key: "lord1", x: 580, y: 12, w: 34, h: 39 },
  { key: "gold1", x: 743, y: 12, w: 75, h: 38 },
  { key: "killscore1", x: 848, y: 6, w: 51, h: 43 },
  { key: "timer", x: 921, y: 7, w: 80, h: 40 },
  { key: "killscore2", x: 1022, y: 7, w: 49, h: 42 },
  { key: "gold2", x: 1137, y: 12, w: 68, h: 36 },
  { key: "turret2", x: 1251, y: 11, w: 32, h: 36 },
  { key: "lord2", x: 1329, y: 12, w: 40, h: 36 },
] as const;

export const mlbbHudOcrKeys = mlbbHudOcrPixelRegions.map((region) => region.key);

export const mlbbHudOcrRegions: ScreenOcrRegion[] = mlbbHudOcrPixelRegions.map((region) => ({
  key: region.key,
  rect: [
    roundRect(region.x / falseOcrReferenceFrame.width),
    roundRect(region.y / falseOcrReferenceFrame.height),
    roundRect(region.w / falseOcrReferenceFrame.width),
    roundRect(region.h / falseOcrReferenceFrame.height),
  ],
}));

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
  profile?: unknown;
};

type MlbbHudOcrFeedOptions = {
  url?: unknown;
  port?: unknown;
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
    mlbbHudRegions: mlbbHudOcrRegions,
  };
}

export async function getMlbbHudOcrFeedStatus(options: MlbbHudOcrFeedOptions | string = {}) {
  const urls = resolveMlbbHudOcrFeedUrls(normalizeMlbbHudOcrFeedOptions(options));
  const errors: string[] = [];
  for (const url of urls) {
    try {
      return {
        connected: true,
        candidates: urls,
        ...await readMlbbHudOcrFeed(url),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "MLBB HUD OCR feed unavailable.";
      errors.push(`${url}: ${message}`);
    }
  }

  return {
    connected: false,
    url: urls[0],
    candidates: urls,
    error: errors[0] ?? "MLBB HUD OCR feed unavailable.",
    observedAt: Date.now(),
    fields: normalizeMlbbHudOcrFeedPayload({}),
  };
}

export async function readMlbbHudOcrFeed(url = resolveMlbbHudOcrFeedUrls()[0]) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 1800);
  try {
    const response = await fetch(withCacheBuster(url), {
      cache: "no-store",
      signal: controller.signal,
      headers: { "cache-control": "no-cache" },
    });
    if (!response.ok) throw new Error(`MLBB HUD OCR feed returned HTTP ${response.status}.`);
    const raw = await response.json();
    return {
      url,
      observedAt: Date.now(),
      fields: normalizeMlbbHudOcrFeedPayload(raw),
      raw,
    };
  } finally {
    clearTimeout(timeout);
  }
}

export function resolveMlbbHudOcrFeedUrls(options: MlbbHudOcrFeedOptions = {}) {
  const candidates = [
    normalizeMlbbHudOcrFeedUrl(options.url),
    ...mlbbHudOcrFeedUrlsForPort(options.port),
    normalizeMlbbHudOcrFeedUrl(process.env.MLBB_HUD_OCR_FEED_URL),
    ...mlbbHudOcrFeedUrlsForPort(14337),
  ].filter((url): url is string => Boolean(url));
  return [...new Set(candidates)];
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
  const regions = resolveScreenOcrRegions(options);
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

export function resolveScreenOcrRegions(options: Pick<InferOptions, "regions" | "maxRegions" | "profile"> = {}): ScreenOcrRegion[] {
  const profile = String(options.profile ?? "").toLowerCase();
  const defaultMaxRegions = profile === "mlbb-hud" ? mlbbHudOcrRegions.length : 8;
  const maxRegions = Math.max(1, Math.min(12, Number(options.maxRegions ?? defaultMaxRegions)));
  if (options.regions != null) return normalizeScreenOcrRegions(options.regions).slice(0, maxRegions);
  if (profile === "mlbb-hud") {
    return mlbbHudOcrRegions.map((region) => ({ key: region.key, rect: [...region.rect] as ScreenOcrRegion["rect"] })).slice(0, maxRegions);
  }
  return defaultScreenOcrRegions.map((region) => ({ key: region.key, rect: [...region.rect] as ScreenOcrRegion["rect"] })).slice(0, maxRegions);
}

export function normalizeScreenTextFacts(value: unknown, observedAt = Date.now()): ScreenTextFact[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((fact: any) => {
      const rect = firstRect(fact?.rect);
      const words = normalizeCandidates(fact?.candidates);
      const region = normalizeRegionKey(fact?.key ?? fact?.region ?? "screen");
      return {
        region,
        text: normalizeMlbbHudOcrText(region, normalizeOcrText(fact?.text)),
        confidence: clamp01(fact?.confidence),
        rect,
        words,
        source: "paddleocr-screen" as const,
        observedAt,
      };
    })
    .filter((fact): fact is ScreenTextFact => Boolean(fact.region) && fact.rect !== null)
    .slice(0, 12);
}

export function normalizeMlbbHudOcrText(region: unknown, value: unknown) {
  const key = normalizeRegionKey(region);
  const raw = normalizeOcrText(value);
  if (!raw) return "";
  const substituted = raw
    .replace(/[oOQD]/g, "0")
    .replace(/[lI|\]\[!i]/g, "1")
    .replace(/[Zz]/g, "2")
    .replace(/A/g, "4")
    .replace(/[Ss]/g, "5")
    .replace(/G/g, "6")
    .replace(/T/g, "7")
    .replace(/B/g, "8")
    .replace(/g/g, "9");

  if (key === "gold1" || key === "gold2") {
    const compact = substituted.toLowerCase().replace(/[^0-9k]/g, "");
    if (compact.includes("k")) {
      const nums = compact.split("k")[0].replace(/[^0-9]/g, "");
      if (nums.length === 3) return `${nums.slice(0, 2)}.${nums.slice(2)}k`;
      if (nums.length === 2) return `${nums}k`;
      if (nums.length > 3) return `${nums.slice(0, 2)}.${nums.slice(2, 3)}k`;
      return nums ? `${nums}k` : "";
    }
    const nums = compact.replace(/[^0-9]/g, "");
    return nums.length >= 4 ? nums.slice(0, 4) : nums;
  }

  if (key === "timer") {
    const timer = substituted.replace(/[.;]/g, ":").replace(/[^0-9:]/g, "");
    if (timer.includes(":")) {
      const [minutes = "", seconds = ""] = timer.split(":");
      return `${minutes.slice(-2)}:${seconds.padStart(2, "0").slice(0, 2)}`.replace(/^:/, "");
    }
    if (timer.length >= 3) return `${timer.slice(0, -2)}:${timer.slice(-2)}`;
    return timer;
  }

  if (/^(turret|lord|killscore)[12]$/.test(key)) {
    return substituted.replace(/[^0-9]/g, "").slice(0, 3);
  }

  return raw;
}

export function normalizeMlbbHudOcrFeedPayload(value: unknown) {
  const input = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return Object.fromEntries(mlbbHudOcrKeys.map((key) => [
    key,
    normalizeMlbbHudOcrText(key, input[key]),
  ])) as Record<typeof mlbbHudOcrKeys[number], string>;
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

function roundRect(value: number) {
  return Number(value.toFixed(6));
}

function normalizeMlbbHudOcrFeedOptions(options: MlbbHudOcrFeedOptions | string) {
  return typeof options === "string" ? { url: options } : options;
}

function mlbbHudOcrFeedUrlsForPort(value: unknown) {
  const port = normalizeMlbbHudOcrFeedPort(value);
  if (port === null) return [] as string[];
  return [
    `http://127.0.0.1:${port}/MLBB.json`,
    `http://localhost:${port}/MLBB.json`,
  ];
}

function normalizeMlbbHudOcrFeedPort(value: unknown) {
  const text = String(value ?? "").trim();
  if (!text) return null;
  const port = Number(text);
  return Number.isInteger(port) && port > 0 && port < 65536 ? port : null;
}

function normalizeMlbbHudOcrFeedUrl(value: unknown) {
  const raw = String(value ?? "").trim();
  if (!raw || /^\d{1,5}$/.test(raw)) return null;
  const withProtocol = /^[a-z][a-z\d+\-.]*:\/\//i.test(raw) ? raw : `http://${raw}`;
  try {
    const url = new URL(withProtocol);
    if (!url.pathname || url.pathname === "/") url.pathname = "/MLBB.json";
    return url.toString();
  } catch {
    return null;
  }
}

function withCacheBuster(url: string) {
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}t=${Date.now()}`;
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
