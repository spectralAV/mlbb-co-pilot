import { execFile, execFileSync, spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync } from "node:fs";
import { access, mkdir, stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { getLatestLiveVision, ingestLiveVisionFrame, type VisionScreenState } from "./liveVisionState.js";
import { ingestDraftRecognition } from "./draftRecognition.js";
import { detectNativeDraftVisualContext } from "./nativeDraftContext.js";
import { firstNormalizedRegion, getActiveObsRegions, type NormalizedRect } from "../services/obsCoachState.js";
import { isRawVideoFrame, type VisionFrameInput } from "./rawFrame.js";
import { recognizeTimerDetections, type TimerFact } from "./timerRecognition.js";
import { recordVisionReflection } from "./visionReflection.js";

const execFileAsync = promisify(execFile);
const projectRoot = path.resolve(process.cwd(), "..");
const cvRoot = path.join(projectRoot, "data", "cv");
const managedPython = path.join(cvRoot, ".venv", "Scripts", "python.exe");
const script = path.join(projectRoot, "backend", "tools", "ultralyticsVision.py");
const workerScript = path.join(projectRoot, "backend", "tools", "ultralyticsWorker.py");
const wslSetupScript = path.join(projectRoot, "backend", "tools", "setupWslRocmRuntime.sh");
const requirements = path.join(projectRoot, "backend", "cv", "requirements.txt");
const weights = path.join(cvRoot, "models", "mlbb-detect.pt");
const defaultMinimapRect: NormalizedRect = [0.02521, 0, 0.146359, 0.326563];
const workerInferenceTimeoutMs = Math.max(1000, numberFromEnv(process.env.ULTRALYTICS_WORKER_TIMEOUT_MS, 30000));
type UltralyticsRuntimeKind = "windows" | "wsl";

export type UltralyticsDetection = {
  classId: number;
  className: string;
  confidence: number;
  bbox: [number, number, number, number];
  center: [number, number];
  source: "ultralytics-yolo";
  trackId?: string;
  trackAge?: number;
  trackMissingFrames?: number;
};

export type UltralyticsTrackingOptions = {
  streamId?: string;
  now?: number;
  iouThreshold?: number;
  maxAgeMs?: number;
  maxMissingFrames?: number;
  maxCenterDistance?: number;
  smoothing?: number;
};

export type UltralyticsDeviceStatus = {
  requested: string;
  selected: string;
  type: string;
  name: string | null;
  torchAvailable: boolean;
  torchVersion: string | null;
  cudaAvailable: boolean;
  cudaVersion: string | null;
  hipAvailable?: boolean;
  hipVersion?: string | null;
  cudaDeviceCount: number;
  cudaDevices: string[];
  directmlAvailable?: boolean;
  directmlVersion?: string | null;
  directmlDeviceCount?: number;
  directmlDevices?: string[];
  warning: string;
};

export type UltralyticsStatus = {
  engine: "ultralytics";
  packageAvailable: boolean;
  modelAvailable: boolean;
  onnxModelAvailable: boolean;
  weights: string;
  onnxModel: string;
  dataset: string;
  classes: string[];
  training: { images: number; labels: number };
  validation: { images: number; labels: number };
  managedRuntime: boolean;
  runtime: "windows" | "wsl";
  python: string;
  trainingRuntime: "windows" | "wsl";
  trainingPython: string;
  trainingDevice: UltralyticsDeviceStatus;
  wslDistro?: string;
  device: UltralyticsDeviceStatus;
  inferenceBackend: {
    requested: string;
    selected: string;
    onnxModelAvailable: boolean;
    onnxModel: string;
    onnxRuntime: {
      packageAvailable: boolean;
      version: string | null;
      providers: string[];
      directmlAvailable: boolean;
    };
    torch: UltralyticsDeviceStatus;
    warning: string;
  };
};

export type NativeObsUltralyticsStatus = {
  mode: "backend-native-obs";
  active: boolean;
  modelAvailable: boolean;
  workerRunning: boolean;
  queuedFrames: number;
  processedFrames: number;
  droppedFrames: number;
  publishedFacts: number;
  lastFrameAt: string | null;
  lastInferenceAt: string | null;
  lastLatencyMs: number | null;
  lastDetectionCount: number;
  error: string;
};

type WorkerRequest = {
  resolve: (detections: UltralyticsDetection[]) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
};

type UltralyticsTrack = {
  id: string;
  className: string;
  bbox: [number, number, number, number];
  center: [number, number];
  confidence: number;
  firstSeenAt: number;
  lastSeenAt: number;
  missingFrames: number;
  hits: number;
};

type UltralyticsTrackerState = {
  sequence: number;
  tracks: UltralyticsTrack[];
};

let worker: ChildProcessWithoutNullStreams | null = null;
let workerWeightsMtimeMs: number | null = null;
let workerStdout = "";
let workerSequence = 0;
let cachedWslHome: string | null = null;
const workerRequests = new Map<number, WorkerRequest>();
let pendingObsFrame: { frame: VisionFrameInput; source: string; receivedAt: number } | null = null;
let obsProcessing = false;
let lastStatusCheckAt = 0;
let cachedModelAvailable = false;
const ultralyticsTrackers = new Map<string, UltralyticsTrackerState>();
const nativeObsStatus: NativeObsUltralyticsStatus = {
  mode: "backend-native-obs",
  active: false,
  modelAvailable: false,
  workerRunning: false,
  queuedFrames: 0,
  processedFrames: 0,
  droppedFrames: 0,
  publishedFacts: 0,
  lastFrameAt: null,
  lastInferenceAt: null,
  lastLatencyMs: null,
  lastDetectionCount: 0,
  error: "",
};

function numberFromEnv(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function resetUltralyticsTracking(streamId?: string) {
  if (streamId) ultralyticsTrackers.delete(streamId);
  else ultralyticsTrackers.clear();
}

export function stabilizeUltralyticsDetections(detections: UltralyticsDetection[], options: UltralyticsTrackingOptions = {}) {
  const tracking = resolveTrackingOptions(options);
  const state = getTrackerState(tracking.streamId);
  state.tracks = state.tracks.filter((track) => isLiveTrack(track, tracking.now, tracking.maxAgeMs, tracking.maxMissingFrames));

  if (!detections.length) {
    markMissingTracks(state.tracks);
    state.tracks = state.tracks.filter((track) => isLiveTrack(track, tracking.now, tracking.maxAgeMs, tracking.maxMissingFrames));
    return detections;
  }

  const assignedTracks = new Set<UltralyticsTrack>();
  const stabilized = new Map<number, UltralyticsDetection>();
  const ordered = detections
    .map((detection, index) => ({ detection, index }))
    .sort((left, right) => right.detection.confidence - left.detection.confidence);

  for (const { detection, index } of ordered) {
    const track = findBestTrack(detection, state.tracks, assignedTracks, tracking);
    if (track) {
      const bbox = blendBox(track.bbox, detection.bbox, tracking.smoothing);
      const center = blendPoint(track.center, detection.center, tracking.smoothing);
      track.bbox = bbox;
      track.center = center;
      track.confidence = detection.confidence;
      track.lastSeenAt = tracking.now;
      track.missingFrames = 0;
      track.hits += 1;
      assignedTracks.add(track);
      stabilized.set(index, {
        ...detection,
        bbox,
        center,
        trackId: track.id,
        trackAge: track.hits,
        trackMissingFrames: 0,
      });
      continue;
    }

    const created = createTrack(state, detection, tracking.now);
    assignedTracks.add(created);
    stabilized.set(index, {
      ...detection,
      trackId: created.id,
      trackAge: created.hits,
      trackMissingFrames: 0,
    });
  }

  for (const track of state.tracks) {
    if (!assignedTracks.has(track)) track.missingFrames += 1;
  }
  state.tracks = state.tracks
    .filter((track) => isLiveTrack(track, tracking.now, tracking.maxAgeMs, tracking.maxMissingFrames))
    .sort((left, right) => right.lastSeenAt - left.lastSeenAt || right.confidence - left.confidence)
    .slice(0, 128);
  return detections.map((detection, index) => stabilized.get(index) ?? detection);
}

function resolveTrackingOptions(options: UltralyticsTrackingOptions) {
  return {
    streamId: options.streamId ?? "browser-capture",
    now: options.now ?? Date.now(),
    iouThreshold: clamp01(options.iouThreshold ?? numberFromEnv(process.env.ULTRALYTICS_TRACK_IOU, 0.18)),
    maxAgeMs: Math.max(0, options.maxAgeMs ?? numberFromEnv(process.env.ULTRALYTICS_TRACK_MAX_AGE_MS, 3000)),
    maxMissingFrames: Math.max(0, Math.floor(options.maxMissingFrames ?? numberFromEnv(process.env.ULTRALYTICS_TRACK_MAX_MISSING_FRAMES, 2))),
    maxCenterDistance: Math.max(0, options.maxCenterDistance ?? numberFromEnv(process.env.ULTRALYTICS_TRACK_CENTER_DISTANCE, 0.035)),
    smoothing: clamp01(options.smoothing ?? numberFromEnv(process.env.ULTRALYTICS_TRACK_SMOOTHING, 0.65)),
  };
}

function getTrackerState(streamId: string) {
  const existing = ultralyticsTrackers.get(streamId);
  if (existing) return existing;
  const created: UltralyticsTrackerState = { sequence: 0, tracks: [] };
  ultralyticsTrackers.set(streamId, created);
  return created;
}

function markMissingTracks(tracks: UltralyticsTrack[]) {
  for (const track of tracks) track.missingFrames += 1;
}

function isLiveTrack(track: UltralyticsTrack, now: number, maxAgeMs: number, maxMissingFrames: number) {
  return now - track.lastSeenAt <= maxAgeMs && track.missingFrames <= maxMissingFrames;
}

function findBestTrack(
  detection: UltralyticsDetection,
  tracks: UltralyticsTrack[],
  assignedTracks: Set<UltralyticsTrack>,
  options: ReturnType<typeof resolveTrackingOptions>,
) {
  let best: UltralyticsTrack | null = null;
  let bestScore = 0;
  for (const track of tracks) {
    if (assignedTracks.has(track) || track.className !== detection.className) continue;
    const overlap = bboxIou(track.bbox, detection.bbox);
    const distanceScore = centerDistanceScore(track, detection, options.maxCenterDistance);
    if (overlap < options.iouThreshold && distanceScore <= 0) continue;
    const score = Math.max(overlap, distanceScore * 0.9);
    if (score > bestScore) {
      best = track;
      bestScore = score;
    }
  }
  return best;
}

function createTrack(state: UltralyticsTrackerState, detection: UltralyticsDetection, now: number): UltralyticsTrack {
  const track: UltralyticsTrack = {
    id: nextTrackId(state, detection.className),
    className: detection.className,
    bbox: detection.bbox,
    center: detection.center,
    confidence: detection.confidence,
    firstSeenAt: now,
    lastSeenAt: now,
    missingFrames: 0,
    hits: 1,
  };
  state.tracks.push(track);
  return track;
}

function nextTrackId(state: UltralyticsTrackerState, className: string) {
  const safeClass = className.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "object";
  state.sequence += 1;
  return `yolo-track-${safeClass}-${state.sequence}`;
}

function bboxIou(left: [number, number, number, number], right: [number, number, number, number]) {
  const leftRight = left[0] + left[2];
  const leftBottom = left[1] + left[3];
  const rightRight = right[0] + right[2];
  const rightBottom = right[1] + right[3];
  const intersectionWidth = Math.max(0, Math.min(leftRight, rightRight) - Math.max(left[0], right[0]));
  const intersectionHeight = Math.max(0, Math.min(leftBottom, rightBottom) - Math.max(left[1], right[1]));
  const intersectionArea = intersectionWidth * intersectionHeight;
  if (intersectionArea <= 0) return 0;
  const unionArea = left[2] * left[3] + right[2] * right[3] - intersectionArea;
  return unionArea > 0 ? intersectionArea / unionArea : 0;
}

function centerDistanceScore(track: UltralyticsTrack, detection: UltralyticsDetection, fallbackDistance: number) {
  const distance = Math.hypot(track.center[0] - detection.center[0], track.center[1] - detection.center[1]);
  const sizeLimit = Math.max(track.bbox[2], track.bbox[3], detection.bbox[2], detection.bbox[3]) * 2.5;
  const limit = Math.max(fallbackDistance, sizeLimit);
  if (limit <= 0 || distance > limit) return 0;
  return 1 - distance / limit;
}

function blendBox(previous: [number, number, number, number], current: [number, number, number, number], currentWeight: number): [number, number, number, number] {
  return [
    blendNumber(previous[0], current[0], currentWeight),
    blendNumber(previous[1], current[1], currentWeight),
    blendNumber(previous[2], current[2], currentWeight),
    blendNumber(previous[3], current[3], currentWeight),
  ];
}

function blendPoint(previous: [number, number], current: [number, number], currentWeight: number): [number, number] {
  return [
    blendNumber(previous[0], current[0], currentWeight),
    blendNumber(previous[1], current[1], currentWeight),
  ];
}

function blendNumber(previous: number, current: number, currentWeight: number) {
  return previous * (1 - currentWeight) + current * currentWeight;
}

export async function getUltralyticsStatus(): Promise<UltralyticsStatus> {
  const runner = pythonRunner();
  const trainingRunner = trainingPythonRunner();
  const managedRuntime = useWslRuntime() ? true : await exists(managedPython);
  const result = await runJson(["status", "--device", ultralyticsDevice()]);
  const trainingDevice = await getTrainingDeviceStatus(result.device, runner, trainingRunner);
  return {
    ...result,
    managedRuntime,
    runtime: runner.runtime,
    python: runner.python,
    trainingRuntime: trainingRunner.runtime,
    trainingPython: trainingRunner.python,
    trainingDevice,
    ...(runner.runtime === "wsl" ? { wslDistro: wslDistro() } : {}),
  };
}

export async function installUltralyticsRuntime() {
  await mkdir(cvRoot, { recursive: true });
  if (useWslRuntime()) {
    await execFileAsync("wsl.exe", ["-d", wslDistro(), "--", "bash", wslPath(wslSetupScript), wslPath(projectRoot)], {
      timeout: 45 * 60 * 1000,
      windowsHide: true,
      maxBuffer: 32 * 1024 * 1024,
    });
    return getUltralyticsStatus();
  }
  if (!(await exists(managedPython))) {
    await execFileAsync("python", ["-m", "venv", path.join(cvRoot, ".venv")], {
      timeout: 120000,
      windowsHide: true,
      maxBuffer: 2 * 1024 * 1024,
    });
  }
  await execFileAsync(managedPython, ["-m", "pip", "install", "--disable-pip-version-check", "-r", requirements], {
    timeout: 20 * 60 * 1000,
    windowsHide: true,
    maxBuffer: 16 * 1024 * 1024,
  });
  return getUltralyticsStatus();
}

export async function trainUltralyticsModel(options: { epochs?: number; imageSize?: number; baseModel?: string; device?: string; batch?: number; workers?: number; amp?: boolean } = {}) {
  const runner = trainingPythonRunner();
  if (runner.runtime === "windows" && !(await exists(managedPython))) throw new Error("Install the Ultralytics runtime before training.");
  const status = await runJson(["status", "--device", ultralyticsDevice(options.device)], 20000, runner);
  assertTrainingAccelerator(status.device);
  const resolvedBaseModel = await resolveTrainingBaseModel(options.baseModel);
  const baseModel = runner.runtime === "wsl" && path.isAbsolute(resolvedBaseModel) ? wslPath(resolvedBaseModel) : resolvedBaseModel;
  const args = [
    "train",
    "--base-model", baseModel,
    "--epochs", String(Math.max(1, Number(options.epochs ?? 60))),
    "--image-size", String(Math.max(320, Number(options.imageSize ?? 960))),
    "--batch", String(Math.max(1, Number(options.batch ?? 4))),
    "--workers", String(Math.max(0, Number(options.workers ?? 0))),
    "--amp", String(Boolean(options.amp ?? false)),
    "--device", ultralyticsDevice(options.device),
  ];
  const result = await runJson(args, 24 * 60 * 60 * 1000, runner);
  shutdownWorker("Ultralytics model was retrained; reloading weights.");
  lastStatusCheckAt = 0;
  return result;
}

async function getTrainingDeviceStatus(fallback: UltralyticsDeviceStatus, runner: ReturnType<typeof pythonRunner>, trainingRunner: ReturnType<typeof pythonRunner>) {
  if (runner.runtime === trainingRunner.runtime && runner.python === trainingRunner.python) return fallback;
  try {
    const status = await runJson(["status", "--device", ultralyticsDevice()], 20000, trainingRunner);
    return status.device as UltralyticsDeviceStatus;
  } catch (error) {
    return {
      ...fallback,
      selected: "unavailable",
      type: "unavailable",
      name: null,
      warning: `Training runtime unavailable: ${error instanceof Error ? error.message : "status check failed"}`,
    };
  }
}

function assertTrainingAccelerator(device: UltralyticsDeviceStatus) {
  const type = String(device?.type ?? "").toLowerCase();
  const selected = String(device?.selected ?? "").toLowerCase();
  if (type === "cpu" || selected === "cpu") {
    throw new Error("PyTorch CPU training is disabled. Configure CUDA, torch-directml, or WSL ROCm before starting Ultralytics training.");
  }
  if (type === "unavailable" || selected === "unavailable") {
    throw new Error(device.warning || "Training runtime is unavailable.");
  }
  if ((type === "cuda" || type === "rocm") && !device.cudaAvailable) {
    throw new Error(device.warning || "A GPU training device was requested, but PyTorch cannot see a compatible CUDA/ROCm device.");
  }
  if (type === "directml" && device.directmlAvailable === false) {
    throw new Error(device.warning || "DirectML was requested, but torch-directml is not available.");
  }
}

export async function inferUltralyticsFrame(image: Buffer, confidence = 0.55, streamId = "browser-capture") {
  const status = await getUltralyticsStatus();
  if (!status.packageAvailable || !status.modelAvailable) return { ...status, ready: false, detections: [] as UltralyticsDetection[] };
  const detections = stabilizeUltralyticsDetections(await requestWorkerInference(image, confidence), { streamId });
  return { ...status, ready: true, detections };
}

export function mapUltralyticsMinimapMarkers(detections: UltralyticsDetection[], minimap: NormalizedRect = defaultMinimapRect) {
  return detections
    .filter((detection) =>
      (detection.className === "ally_hero_marker" || detection.className === "enemy_hero_marker") &&
      inMinimap(detection.center, minimap))
    .map((detection, index) => ({
      id: detection.trackId ?? `yolo-${detection.className}-${index}`,
      side: detection.className === "enemy_hero_marker" ? "enemy" as const : "ally" as const,
      markerClass: "ultralytics-yolo" as const,
      minimap: toMinimapPoint(detection.center, minimap),
      confidence: clamp01(detection.confidence),
    }));
}

export function mapUltralyticsMinimapObjects(detections: UltralyticsDetection[], minimap: NormalizedRect = defaultMinimapRect) {
  const objectClasses = new Set(["turtle", "lord", "ally_turret", "enemy_turret"]);
  return detections
    .filter((detection) => objectClasses.has(detection.className) && inMinimap(detection.center, minimap))
    .map((detection, index) => ({
      id: detection.trackId ?? `yolo-map-${detection.className}-${index}`,
      objectType: detection.className as "turtle" | "lord" | "ally_turret" | "enemy_turret",
      minimap: toMinimapPoint(detection.center, minimap),
      confidence: clamp01(detection.confidence),
      source: "ultralytics-yolo" as const,
    }));
}

export function getNativeObsUltralyticsStatus() {
  return { ...nativeObsStatus, workerRunning: Boolean(worker && !worker.killed) };
}

export function queueNativeObsUltralyticsFrame(frame: VisionFrameInput, source = "obs-scrcpy-plugin") {
  nativeObsStatus.queuedFrames += 1;
  nativeObsStatus.lastFrameAt = new Date().toISOString();
  if (pendingObsFrame) nativeObsStatus.droppedFrames += 1;
  pendingObsFrame = { frame, source, receivedAt: Date.now() };
  if (!obsProcessing) void processNativeObsQueue();
  return getNativeObsUltralyticsStatus();
}

export function publishNativeObsDetections(detections: UltralyticsDetection[], source = "obs-scrcpy-plugin", calibratedRegions: Record<string, unknown> = {}, timerFacts: TimerFact[] = []) {
  const confident = detections.filter((detection) => Number(detection.confidence) >= 0.55);
  const accepted = confident.some((detection) => detection.trackId)
    ? confident
    : stabilizeUltralyticsDetections(confident, { streamId: `publish:${source}` });
  if (!accepted.length) {
    void recordVisionReflection({
      category: "ultralytics",
      outcome: "rejected",
      source,
      reason: detections.length ? "confidence_below_publish_threshold" : "no_detections",
      detectionCount: detections.length,
      labels: detections.map((detection) => detection.className),
      metadata: { threshold: 0.55 },
    });
    return null;
  }
  const latestVision = getLatestLiveVision();
  const existing = latestVision && Date.now() - latestVision.timestamp < 2500 ? latestVision : null;
  const surface = detectedYoloSurface(accepted);
  const minimapRegion = firstNormalizedRegion(calibratedRegions.minimap_norm) ?? defaultMinimapRect;
  const minimapMarkers = mapUltralyticsMinimapMarkers(accepted, minimapRegion);
  const minimapObjects = mapUltralyticsMinimapObjects(accepted, minimapRegion);
  const inferredLiveConfidence = accepted
    .filter((detection) => ["ally_hero_marker", "enemy_hero_marker", "turtle", "lord", "ally_turret", "enemy_turret"].includes(detection.className))
    .reduce((highest, detection) => Math.max(highest, detection.confidence), 0);
  const screen = surface?.screen
    ?? (inferredLiveConfidence >= 0.55 ? "live_hud" : existing?.screen ?? "unknown");
  if (screen === "unknown") return null;
  const confidence = Math.max(surface?.confidence ?? 0, inferredLiveConfidence, existing?.screen === screen ? existing.confidence : 0);
  const detectionEvidence = surface
    ? [`Native OBS YOLO surface: ${surface.label}`]
    : minimapMarkers.length ? [`Native OBS YOLO minimap markers: ${minimapMarkers.length}`] : ["Native OBS YOLO visible facts"];
  const keepExisting = existing?.screen === screen;
  nativeObsStatus.publishedFacts += accepted.length;
  return ingestLiveVisionFrame({
    frameId: `native-obs-yolo-${Date.now()}`,
    source: `${source}:ultralytics`,
    timestamp: Date.now(),
    screen,
    confidence,
    evidence: [...(keepExisting ? existing.evidence.slice(0, 8) : []), ...detectionEvidence],
    regions: keepExisting ? existing.regions : undefined,
    minimapMarkers,
    signals: {
      ...(keepExisting ? existing.signals : {}),
      yoloDetections: accepted,
      minimapObjects,
      timerFacts,
    },
  });
}

async function processNativeObsQueue() {
  obsProcessing = true;
  try {
    while (pendingObsFrame) {
      const frame = pendingObsFrame;
      pendingObsFrame = null;
      if (!(await nativeModelAvailable())) continue;
      nativeObsStatus.active = true;
      const startedAt = Date.now();
      try {
        const detections = stabilizeUltralyticsDetections(await requestWorkerInference(frame.frame, 0.55), { streamId: `native:${frame.source}` });
        nativeObsStatus.active = true;
        nativeObsStatus.processedFrames += 1;
        nativeObsStatus.lastInferenceAt = new Date().toISOString();
        nativeObsStatus.lastLatencyMs = Date.now() - startedAt;
        nativeObsStatus.lastDetectionCount = detections.length;
        nativeObsStatus.error = "";
        const calibratedRegions = await getActiveObsRegions();
        if (detectedYoloSurface(detections.filter((detection) => detection.confidence >= 0.55))?.screen === "draft") {
          await publishNativeDraftContext(frame.frame, frame.source, calibratedRegions);
        }
        const timerFacts = await recognizeTimerDetections(frame.frame, detections, Date.now());
        publishNativeObsDetections(detections, frame.source, calibratedRegions, timerFacts);
      } catch (error) {
        nativeObsStatus.error = error instanceof Error ? error.message : "Native OBS inference failed.";
        void recordVisionReflection({
          category: "ultralytics",
          outcome: "failed",
          source: frame.source,
          reason: nativeObsStatus.error,
        });
      }
    }
  } finally {
    obsProcessing = false;
    if (pendingObsFrame) void processNativeObsQueue();
  }
}

async function publishNativeDraftContext(frame: VisionFrameInput, source: string, calibratedRegions: Record<string, unknown>) {
  const context = detectNativeDraftVisualContext(frame, calibratedRegions);
  if (!context.selfSlot && !context.firstPickSide) return;
  await ingestDraftRecognition({
    phase: "pick",
    ...context,
    provisional: true,
    frameId: `${source}:native-draft-context:${Date.now()}`,
    timestamp: Date.now(),
  });
}

async function nativeModelAvailable() {
  if (Date.now() - lastStatusCheckAt > 10000) {
    lastStatusCheckAt = Date.now();
    try {
      const status = await getUltralyticsStatus();
      cachedModelAvailable = status.packageAvailable && status.modelAvailable;
      nativeObsStatus.modelAvailable = cachedModelAvailable;
      if (!cachedModelAvailable) nativeObsStatus.active = false;
    } catch (error) {
      cachedModelAvailable = false;
      nativeObsStatus.modelAvailable = false;
      nativeObsStatus.active = false;
      nativeObsStatus.error = error instanceof Error ? error.message : "Ultralytics status failed.";
    }
  }
  return cachedModelAvailable;
}

function detectedYoloSurface(detections: UltralyticsDetection[]) {
  const mappings: Record<string, VisionScreenState> = {
    minimap_panel: "live_hud",
    draft_screen: "draft",
    ally_pick_slot: "draft",
    enemy_pick_slot: "draft",
    ally_ban_slot: "draft",
    enemy_ban_slot: "draft",
    lane_marker: "draft",
    battle_spell_marker: "draft",
    equipment_scoreboard: "scoreboard",
    attributes_scoreboard: "scoreboard",
    match_timer: "live_hud",
    ally_kill_counter: "live_hud",
    enemy_kill_counter: "live_hud",
    personal_kda: "live_hud",
    personal_gold_counter: "live_hud",
    live_hud_stats_region: "live_hud",
    red_buff: "live_hud",
    blue_buff: "live_hud",
    jungle_creep: "live_hud",
    little_wonder: "live_hud",
    post_match_item_slot: "scoreboard",
  };
  const accepted = detections
    .filter((detection) => mappings[detection.className])
    .sort((left, right) => right.confidence - left.confidence)[0];
  return accepted ? { screen: mappings[accepted.className], label: accepted.className, confidence: accepted.confidence } : null;
}

function inMinimap(center: [number, number], minimap: NormalizedRect) {
  return center[0] >= minimap[0] &&
    center[0] <= minimap[0] + minimap[2] &&
    center[1] >= minimap[1] &&
    center[1] <= minimap[1] + minimap[3];
}

function toMinimapPoint(center: [number, number], minimap: NormalizedRect): [number, number] {
  return [
    clamp01((center[0] - minimap[0]) / minimap[2]),
    clamp01((center[1] - minimap[1]) / minimap[3]),
  ];
}

async function requestWorkerInference(frame: VisionFrameInput, confidence: number) {
  await reloadWorkerIfWeightsChanged();
  return new Promise<UltralyticsDetection[]>((resolve, reject) => {
    const activeWorker = ensureWorker();
    const id = ++workerSequence;
    const timeout = setTimeout(() => {
      rejectWorkerRequest(id, new Error(`Ultralytics worker inference timed out after ${workerInferenceTimeoutMs}ms.`));
      if (worker === activeWorker) shutdownWorker("Ultralytics worker inference timed out; restarting worker.");
    }, workerInferenceTimeoutMs);
    workerRequests.set(id, { resolve, reject, timeout });
    const rejectWrite = (error?: Error | null) => {
      if (!error) return;
      rejectWorkerRequest(id, new Error(`Ultralytics worker stdin write failed: ${error.message}`));
      if (worker === activeWorker) shutdownWorker("Ultralytics worker stdin failed; restarting worker.");
    };
    const header = isRawVideoFrame(frame)
      ? {
          id,
          size: frame.buffer.byteLength,
          confidence,
          encoding: "raw",
          width: frame.width,
          height: frame.height,
          pixelFormat: frame.pixelFormat,
        }
      : { id, size: frame.byteLength, confidence, encoding: "encoded" };
    activeWorker.stdin.write(`${JSON.stringify(header)}\n`, rejectWrite);
    activeWorker.stdin.write(isRawVideoFrame(frame) ? frame.buffer : frame, rejectWrite);
  });
}

function settleWorkerRequest(id: number, handler: (request: WorkerRequest) => void) {
  const request = workerRequests.get(id);
  if (!request) return;
  clearTimeout(request.timeout);
  workerRequests.delete(id);
  handler(request);
}

function rejectWorkerRequest(id: number, error: Error) {
  settleWorkerRequest(id, (request) => request.reject(error));
}

function ensureWorker() {
  if (worker && !worker.killed) return worker;
  workerStdout = "";
  const device = ultralyticsDevice();
  const workerRunner = workerCommand(device);
  const spawnedWorker = spawn(workerRunner.file, workerRunner.args, {
    windowsHide: true,
    env: { ...process.env, ULTRALYTICS_DEVICE: device },
  });
  worker = spawnedWorker;
  spawnedWorker.stdout.setEncoding("utf8");
  spawnedWorker.stdout.on("data", (chunk: string) => {
    if (worker !== spawnedWorker) return;
    workerStdout += chunk;
    let breakAt = workerStdout.indexOf("\n");
    while (breakAt >= 0) {
      const line = workerStdout.slice(0, breakAt).trim();
      workerStdout = workerStdout.slice(breakAt + 1);
      if (line.startsWith("{")) {
        try {
          const payload = JSON.parse(line);
          const id = Number(payload.id);
          settleWorkerRequest(id, (request) => {
            if (payload.ok) request.resolve(Array.isArray(payload.detections) ? payload.detections : []);
            else request.reject(new Error(payload.error ?? "Ultralytics worker inference failed."));
          });
        } catch {
          // Ignore package output that is not a worker protocol response.
        }
      }
      breakAt = workerStdout.indexOf("\n");
    }
  });
  spawnedWorker.stderr.on("data", (chunk) => {
    if (worker !== spawnedWorker) return;
    const text = String(chunk).trim();
    if (text) nativeObsStatus.error = text.slice(-300);
  });
  spawnedWorker.on("exit", () => {
    if (worker !== spawnedWorker) return;
    const error = new Error("Ultralytics worker stopped.");
    for (const request of workerRequests.values()) {
      clearTimeout(request.timeout);
      request.reject(error);
    }
    workerRequests.clear();
    worker = null;
    workerWeightsMtimeMs = null;
    nativeObsStatus.active = false;
  });
  return spawnedWorker;
}

async function reloadWorkerIfWeightsChanged() {
  const currentWeightsMtimeMs = (await stat(weights)).mtimeMs;
  if (worker && workerWeightsMtimeMs !== null && workerWeightsMtimeMs !== currentWeightsMtimeMs) {
    shutdownWorker("Ultralytics weights changed; reloading worker.");
  }
  workerWeightsMtimeMs = currentWeightsMtimeMs;
}

function shutdownWorker(reason: string) {
  const activeWorker = worker;
  worker = null;
  workerStdout = "";
  workerWeightsMtimeMs = null;
  if (activeWorker && !activeWorker.killed) activeWorker.kill();
  const error = new Error(reason);
  for (const request of workerRequests.values()) {
    clearTimeout(request.timeout);
    request.reject(error);
  }
  workerRequests.clear();
  nativeObsStatus.active = false;
}

async function resolveTrainingBaseModel(baseModel: string | undefined) {
  const requested = String(baseModel ?? "").trim();
  if (!requested) {
    return (await exists(weights)) ? projectRelative(weights) : "yolo26n.pt";
  }
  const requestedPath = path.isAbsolute(requested) ? requested : path.join(projectRoot, requested);
  if (await exists(requestedPath)) return requested;
  if (path.normalize(requestedPath) === path.normalize(weights)) return "yolo26n.pt";
  return requested;
}

function projectRelative(file: string) {
  return path.relative(projectRoot, file).replace(/\\/g, "/");
}

async function runJson(command: string[], timeout = 20000, runner = pythonRunner()): Promise<any> {
  let stdout = "";
  try {
    const result = await execFileAsync(runner.file, [...runner.args, runner.script, ...command, "--project-root", runner.projectRoot], {
      timeout,
      windowsHide: true,
      maxBuffer: 64 * 1024 * 1024,
    });
    stdout = String(result.stdout ?? "");
  } catch (error) {
    const failedStdout = String((error as { stdout?: unknown }).stdout ?? "");
    const failedStderr = String((error as { stderr?: unknown }).stderr ?? "");
    const failedPayload = parseJsonPayload(failedStdout);
    if (failedPayload) {
      if (!failedPayload.ok) throw new Error(failedPayload.error ?? commandFailureMessage(error, failedStderr));
      return failedPayload.data;
    }
    throw new Error(commandFailureMessage(error, failedStderr || failedStdout));
  }
  const payload = parseJsonPayload(stdout);
  if (!payload) throw new Error(`Ultralytics command did not return a JSON result.${lastProcessOutput(stdout)}`);
  if (!payload.ok) throw new Error(payload.error ?? "Ultralytics command failed.");
  return payload.data;
}

function parseJsonPayload(output: string) {
  const lines = output.trim().split(/\r?\n/).reverse();
  for (const line of lines) {
    const text = line.trim();
    if (!text.startsWith("{") || !text.endsWith("}")) continue;
    try {
      return JSON.parse(text);
    } catch {
      // Ignore non-protocol JSON-looking output from third-party tooling.
    }
  }
  return null;
}

function commandFailureMessage(error: unknown, output: string) {
  const text = lastProcessOutput(output);
  if (text) return text.replace(/^ Process output: /, "");
  return error instanceof Error ? error.message : "Ultralytics command failed.";
}

function lastProcessOutput(output: string) {
  const text = output.trim().split(/\r?\n/).filter(Boolean).slice(-8).join("\n");
  return text ? ` Process output: ${text}` : "";
}

function ultralyticsDevice(device?: string) {
  const requested = String(device ?? process.env.ULTRALYTICS_DEVICE ?? "auto").trim();
  return requested || "auto";
}

function ultralyticsRuntime() {
  return String(process.env.ULTRALYTICS_RUNTIME ?? "windows").trim().toLowerCase();
}

function useWslRuntime() {
  return runtimeFromName(ultralyticsRuntime()) === "wsl";
}

function ultralyticsTrainingRuntime() {
  return String(process.env.ULTRALYTICS_TRAIN_RUNTIME ?? process.env.ULTRALYTICS_TRAINING_RUNTIME ?? "auto").trim().toLowerCase();
}

function runtimeFromName(value: string): UltralyticsRuntimeKind {
  return ["wsl", "wsl-rocm", "rocm-wsl", "rocm"].includes(value) ? "wsl" : "windows";
}

function trainingPythonRunner() {
  const requested = ultralyticsTrainingRuntime();
  if (runtimeFromName(requested) === "wsl") return pythonRunner("wsl");
  if (["windows", "win", "cuda", "directml", "dml", "amd", "amd-gpu"].includes(requested)) return pythonRunner("windows");
  if (windowsPyTorchAcceleratorAvailable()) return pythonRunner("windows");
  return wslPythonAvailable() ? pythonRunner("wsl") : pythonRunner("windows");
}

function windowsPyTorchAcceleratorAvailable() {
  const python = process.env.ULTRALYTICS_PYTHON || (existsSync(managedPython) ? managedPython : "python");
  try {
    const output = execFileSync(python, ["-c", [
      "import importlib.util, json",
      "info = {'cuda': False, 'directml': False}",
      "try:",
      "    import torch",
      "    info['cuda'] = bool(torch.cuda.is_available() and torch.cuda.device_count() > 0)",
      "except Exception:",
      "    pass",
      "try:",
      "    import torch_directml",
      "    is_available = getattr(torch_directml, 'is_available', None)",
      "    info['directml'] = bool(is_available() if callable(is_available) else True)",
      "except Exception:",
      "    pass",
      "print(json.dumps(info))",
    ].join("\n")], {
      encoding: "utf8",
      windowsHide: true,
      timeout: 10000,
    });
    const info = JSON.parse(output);
    return Boolean(info?.cuda || info?.directml);
  } catch {
    return false;
  }
}

function wslDistro() {
  return String(process.env.ULTRALYTICS_WSL_DISTRO ?? "Ubuntu-24.04").trim() || "Ubuntu-24.04";
}

function wslPython() {
  const configured = String(process.env.ULTRALYTICS_WSL_PYTHON ?? "").trim();
  if (configured) return configured;
  const home = wslHome();
  return home ? `${home}/.mlbb-copilot/cv-rocm/bin/python` : "/usr/local/bin/mlbb-copilot-cv-python";
}

function wslHome() {
  if (cachedWslHome) return cachedWslHome;
  try {
    cachedWslHome = execFileSync("wsl.exe", ["-d", wslDistro(), "--", "bash", "-lc", "printf %s \"$HOME\""], {
      encoding: "utf8",
      windowsHide: true,
      timeout: 10000,
    }).trim();
  } catch {
    cachedWslHome = "";
  }
  return cachedWslHome;
}

function wslPath(file: string) {
  const resolved = path.resolve(file);
  const parsed = path.parse(resolved);
  const drive = parsed.root.slice(0, 1).toLowerCase();
  const rest = resolved.slice(parsed.root.length).replace(/\\/g, "/");
  return `/mnt/${drive}/${rest}`;
}

function shellQuote(value: string) {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function wslPythonAvailable() {
  const python = wslPython();
  if (!python) return false;
  try {
    execFileSync("wsl.exe", ["-d", wslDistro(), "--", "bash", "-lc", `test -x ${shellQuote(python)}`], {
      windowsHide: true,
      timeout: 10000,
    });
    return true;
  } catch {
    return false;
  }
}

function wslEnvArgs(extra: Record<string, string> = {}) {
  const configuredRocdxgLibDir = String(process.env.ULTRALYTICS_WSL_ROCDXG_LIB_DIR ?? "").trim();
  const gfxVersionOverride = String(process.env.ULTRALYTICS_WSL_HSA_OVERRIDE_GFX_VERSION ?? "11.0.2").trim();
  const home = wslHome();
  const rocdxgLibDir = configuredRocdxgLibDir || (home ? `${home}/.mlbb-copilot/rocdxg/lib` : "");
  const libPath = [rocdxgLibDir, "/opt/rocm/lib", "/usr/lib/wsl/lib"].filter(Boolean).join(":");
  return [
    "HSA_ENABLE_DXG_DETECTION=1",
    ...(gfxVersionOverride ? [`HSA_OVERRIDE_GFX_VERSION=${gfxVersionOverride}`] : []),
    "ROCPROFILER_REGISTER_ENABLED=0",
    `LD_LIBRARY_PATH=${libPath}`,
    ...Object.entries(extra).map(([key, value]) => `${key}=${value}`),
  ];
}

function pythonRunner(runtime: UltralyticsRuntimeKind = useWslRuntime() ? "wsl" : "windows") {
  if (runtime === "wsl") {
    return {
      runtime: "wsl" as const,
      python: wslPython(),
      file: "wsl.exe",
      args: ["-d", wslDistro(), "--cd", wslPath(projectRoot), "--", "env", ...wslEnvArgs({ ULTRALYTICS_DEVICE: ultralyticsDevice() }), wslPython()],
      script: wslPath(script),
      projectRoot: wslPath(projectRoot),
    };
  }
  const python = process.env.ULTRALYTICS_PYTHON || (existsSync(managedPython) ? managedPython : "python");
  return {
    runtime: "windows" as const,
    python,
    file: python,
    args: [] as string[],
    script,
    projectRoot,
  };
}

function workerCommand(device: string) {
  if (useWslRuntime()) {
    return {
      file: "wsl.exe",
      args: [
        "-d", wslDistro(), "--", "env",
        ...wslEnvArgs({ ULTRALYTICS_DEVICE: device }),
        wslPython(),
        wslPath(workerScript),
        wslPath(weights),
        device,
      ],
    };
  }
  const python = process.env.ULTRALYTICS_PYTHON || managedPython;
  return { file: python, args: [workerScript, weights, device] };
}

async function exists(file: string) {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}
