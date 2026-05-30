import { execFile } from "node:child_process";
import { access, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { nanoid } from "nanoid";
import sharp from "sharp";
import { DETECTED_FACT_CONFIDENCE } from "../state/matchState.js";
import { listAnnotations } from "./cvAnnotation.js";
import { frameDimensions, sharpFromVisionFrame, type VisionFrameInput } from "./rawFrame.js";

const execFileAsync = promisify(execFile);
const projectRoot = path.resolve(process.cwd(), "..");
const cvRoot = path.join(projectRoot, "data", "cv");
const managedPython = path.join(cvRoot, ".venv", "Scripts", "python.exe");
const script = path.join(projectRoot, "backend", "tools", "timerOcr.py");
const queryRoot = path.join(cvRoot, "timer-ocr", "queries");
const ocrIntervalMs = 750;
const confirmationWindowMs = 3000;

export const timerClasses = [
  "turtle_respawn_timer",
  "lord_respawn_timer",
  "enemy_respawn_timer",
  "ally_respawn_timer",
  "minimap_objective_timer",
  "score_counter",
] as const;
export type TimerClass = typeof timerClasses[number];
export type TimerFact = {
  timerType: TimerClass;
  text: string;
  seconds?: number;
  value?: number;
  confidence: number;
  source: "timer-ocr";
  confirmedAt: number;
};
type TimerCandidate = {
  timerType: TimerClass;
  text: string;
  confidence: number;
  source: "timer-ocr";
  observedAt: number;
};
type TimerMemory = { candidate: TimerCandidate; confirmations: number };
type Detection = { className: string; confidence: number; bbox: [number, number, number, number] };

const memory = new Map<TimerClass, TimerMemory>();
let lastInferenceAt = 0;

export async function getTimerOcrStatus() {
  const tool = await runOcr(["status"]).catch(() => ({ engine: "paddleocr-timer", packageAvailable: false, paddleAvailable: false }));
  const annotations = await listAnnotations();
  const boxes = annotations.flatMap((sample) => sample.boxes).filter((box) => timerClasses.includes(box.className as TimerClass));
  return {
    ...tool,
    labelledTimerBoxes: boxes.length,
    transcribedTimerBoxes: boxes.filter((box) => Boolean(box.transcript)).length,
    temporalConfirmationReads: 2,
  };
}

export async function installTimerOcrRuntime() {
  if (!(await exists(managedPython))) throw new Error("Install the managed CV runtime before PaddleOCR.");
  await execFileAsync(managedPython, [
    "-m", "pip", "install", "--disable-pip-version-check", "paddlepaddle>=3,<4", "paddleocr>=3,<4",
  ], {
    timeout: 30 * 60 * 1000,
    windowsHide: true,
    maxBuffer: 32 * 1024 * 1024,
  });
  return getTimerOcrStatus();
}

export async function inferTimerCrop(image: Buffer, timerType: TimerClass = "enemy_respawn_timer") {
  if (!timerClasses.includes(timerType)) throw new Error("Unsupported timer target.");
  await mkdir(queryRoot, { recursive: true });
  const file = path.join(queryRoot, `${nanoid(10)}.png`);
  await sharp(image).png().toFile(file);
  try {
    const result = await runOcr(["infer", "--image", file, "--timer-type", timerType], 180000);
    const text = normalizeTimerText(result.text);
    const parsed = text ? parseTimerValue(text, timerType) : null;
    return {
      ...result,
      timerType,
      text: text ?? "",
      parsed,
      accepted: Boolean(parsed && Number(result.confidence ?? 0) >= DETECTED_FACT_CONFIDENCE),
    };
  } finally {
    await rm(file, { force: true });
  }
}

export async function recognizeTimerDetections(image: VisionFrameInput, detections: Detection[], timestamp = Date.now()) {
  if (timestamp - lastInferenceAt < ocrIntervalMs) return [] as TimerFact[];
  const timers = detections
    .filter((detection) => timerClasses.includes(detection.className as TimerClass) && detection.confidence >= DETECTED_FACT_CONFIDENCE)
    .slice(0, 3);
  if (!timers.length) return [] as TimerFact[];
  lastInferenceAt = timestamp;
  const facts: TimerFact[] = [];
  const { width, height } = await frameDimensions(image);
  if (!width || !height) return facts;
  for (const detection of timers) {
    const timerType = detection.className as TimerClass;
    const crop = await sharpFromVisionFrame(image).extract(toCrop(detection.bbox, width, height)).png().toBuffer();
    const result = await inferTimerCrop(crop, timerType).catch(() => null);
    if (!result?.accepted || !result.text) continue;
    const fact = stabilizeTimerCandidate({
      timerType,
      text: result.text,
      confidence: Math.min(Number(result.confidence ?? 0), detection.confidence),
      source: "timer-ocr",
      observedAt: timestamp,
    });
    if (fact) facts.push(fact);
  }
  return facts;
}

export function stabilizeTimerCandidate(candidate: TimerCandidate): TimerFact | null {
  const parsed = parseTimerValue(candidate.text, candidate.timerType);
  if (!parsed || candidate.confidence < DETECTED_FACT_CONFIDENCE) return null;
  const previous = memory.get(candidate.timerType);
  const consistent = previous &&
    candidate.observedAt - previous.candidate.observedAt <= confirmationWindowMs &&
    timerValuesConsistent(previous.candidate, candidate);
  const confirmations = consistent ? previous.confirmations + 1 : 1;
  memory.set(candidate.timerType, { candidate, confirmations });
  if (confirmations < 2) return null;
  return {
    timerType: candidate.timerType,
    text: candidate.text,
    ...parsed,
    confidence: candidate.confidence,
    source: "timer-ocr",
    confirmedAt: candidate.observedAt,
  };
}

export function resetTimerRecognition() {
  memory.clear();
  lastInferenceAt = 0;
}

export function parseTimerValue(text: string, timerType: TimerClass) {
  const normalized = normalizeTimerText(text);
  if (!normalized) return null;
  if (timerType === "score_counter") {
    const value = Number(normalized);
    return Number.isInteger(value) && value >= 0 && value <= 999 ? { value } : null;
  }
  const parts = normalized.split(":").map(Number);
  if (parts.length === 2 && parts[1] > 59) return null;
  const seconds = parts.length === 2 ? parts[0] * 60 + parts[1] : parts[0];
  return Number.isInteger(seconds) && seconds >= 0 && seconds <= 599 ? { seconds } : null;
}

function timerValuesConsistent(previous: TimerCandidate, next: TimerCandidate) {
  const left = parseTimerValue(previous.text, previous.timerType);
  const right = parseTimerValue(next.text, next.timerType);
  if (!left || !right) return false;
  if ("value" in left || "value" in right) return "value" in left && "value" in right && left.value === right.value;
  const elapsed = Math.max(0, Math.round((next.observedAt - previous.observedAt) / 1000));
  return Math.abs((left.seconds - elapsed) - right.seconds) <= 2;
}

function normalizeTimerText(value: unknown) {
  const text = String(value ?? "").replace(/\s+/g, "").replace(/[Oo]/g, "0").replace(/[lI|]/g, "1");
  const match = text.match(/\d{1,3}:\d{2}|\d{1,3}/);
  return match?.[0];
}

function toCrop(rect: [number, number, number, number], width: number, height: number) {
  const left = Math.max(0, Math.min(width - 1, Math.floor(rect[0] * width)));
  const top = Math.max(0, Math.min(height - 1, Math.floor(rect[1] * height)));
  return {
    left,
    top,
    width: Math.max(1, Math.min(width - left, Math.ceil(rect[2] * width))),
    height: Math.max(1, Math.min(height - top, Math.ceil(rect[3] * height))),
  };
}

async function runOcr(args: string[], timeout = 30000) {
  if (!(await exists(managedPython))) throw new Error("Install the managed CV runtime before OCR.");
  const { stdout } = await execFileAsync(managedPython, [script, ...args, "--project-root", projectRoot], {
    timeout,
    windowsHide: true,
    maxBuffer: 16 * 1024 * 1024,
  });
  const jsonLine = stdout.trim().split(/\r?\n/).reverse().find((line) => line.trim().startsWith("{"));
  if (!jsonLine) throw new Error("Timer OCR returned no structured response.");
  const response = JSON.parse(jsonLine);
  if (!response.ok) throw new Error(response.error ?? "Timer OCR failed.");
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
