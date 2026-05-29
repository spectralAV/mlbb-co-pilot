import { execFile, execFileSync, spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync } from "node:fs";
import { access, mkdir, stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { getLatestLiveVision, ingestLiveVisionFrame, type VisionScreenState } from "./liveVisionState.js";
import { ingestDraftRecognition } from "./draftRecognition.js";
import { detectNativeDraftVisualContext } from "./nativeDraftContext.js";
import { firstNormalizedRegion, getActiveObsRegions, type NormalizedRect } from "../services/obsCoachState.js";
import { recognizeTimerDetections, type TimerFact } from "./timerRecognition.js";

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

let worker: ChildProcessWithoutNullStreams | null = null;
let workerWeightsMtimeMs: number | null = null;
let workerStdout = "";
let workerSequence = 0;
let cachedWslHome: string | null = null;
const workerRequests = new Map<number, WorkerRequest>();
let pendingObsFrame: { image: Buffer; source: string; receivedAt: number } | null = null;
let obsProcessing = false;
let lastStatusCheckAt = 0;
let cachedModelAvailable = false;
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

export async function getUltralyticsStatus(): Promise<UltralyticsStatus> {
  const runner = pythonRunner();
  const managedRuntime = useWslRuntime() ? true : await exists(managedPython);
  const result = await runJson(["status", "--device", ultralyticsDevice()]);
  return {
    ...result,
    managedRuntime,
    runtime: runner.runtime,
    python: runner.python,
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

export async function inferUltralyticsFrame(image: Buffer, confidence = 0.55) {
  const status = await getUltralyticsStatus();
  if (!status.packageAvailable || !status.modelAvailable) return { ...status, ready: false, detections: [] as UltralyticsDetection[] };
  const detections = await requestWorkerInference(image, confidence);
  return { ...status, ready: true, detections };
}

export function mapUltralyticsMinimapMarkers(detections: UltralyticsDetection[], minimap: NormalizedRect = defaultMinimapRect) {
  return detections
    .filter((detection) =>
      (detection.className === "ally_hero_marker" || detection.className === "enemy_hero_marker") &&
      inMinimap(detection.center, minimap))
    .map((detection, index) => ({
      id: `yolo-${detection.className}-${index}`,
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
      id: `yolo-map-${detection.className}-${index}`,
      objectType: detection.className as "turtle" | "lord" | "ally_turret" | "enemy_turret",
      minimap: toMinimapPoint(detection.center, minimap),
      confidence: clamp01(detection.confidence),
      source: "ultralytics-yolo" as const,
    }));
}

export function getNativeObsUltralyticsStatus() {
  return { ...nativeObsStatus, workerRunning: Boolean(worker && !worker.killed) };
}

export function queueNativeObsUltralyticsFrame(image: Buffer, source = "obs-scrcpy-plugin") {
  nativeObsStatus.queuedFrames += 1;
  nativeObsStatus.lastFrameAt = new Date().toISOString();
  if (pendingObsFrame) nativeObsStatus.droppedFrames += 1;
  pendingObsFrame = { image: Buffer.from(image), source, receivedAt: Date.now() };
  if (!obsProcessing) void processNativeObsQueue();
  return getNativeObsUltralyticsStatus();
}

export function publishNativeObsDetections(detections: UltralyticsDetection[], source = "obs-scrcpy-plugin", calibratedRegions: Record<string, unknown> = {}, timerFacts: TimerFact[] = []) {
  const accepted = detections.filter((detection) => Number(detection.confidence) >= 0.55);
  if (!accepted.length) return null;
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
        const detections = await requestWorkerInference(frame.image, 0.55);
        nativeObsStatus.active = true;
        nativeObsStatus.processedFrames += 1;
        nativeObsStatus.lastInferenceAt = new Date().toISOString();
        nativeObsStatus.lastLatencyMs = Date.now() - startedAt;
        nativeObsStatus.lastDetectionCount = detections.length;
        nativeObsStatus.error = "";
        const calibratedRegions = await getActiveObsRegions();
        if (detectedYoloSurface(detections.filter((detection) => detection.confidence >= 0.55))?.screen === "draft") {
          await publishNativeDraftContext(frame.image, frame.source, calibratedRegions);
        }
        const timerFacts = await recognizeTimerDetections(frame.image, detections, Date.now());
        publishNativeObsDetections(detections, frame.source, calibratedRegions, timerFacts);
      } catch (error) {
        nativeObsStatus.error = error instanceof Error ? error.message : "Native OBS inference failed.";
      }
    }
  } finally {
    obsProcessing = false;
    if (pendingObsFrame) void processNativeObsQueue();
  }
}

async function publishNativeDraftContext(image: Buffer, source: string, calibratedRegions: Record<string, unknown>) {
  const context = detectNativeDraftVisualContext(image, calibratedRegions);
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

async function requestWorkerInference(image: Buffer, confidence: number) {
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
    activeWorker.stdin.write(`${JSON.stringify({ id, size: image.byteLength, confidence })}\n`, rejectWrite);
    activeWorker.stdin.write(image, rejectWrite);
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
  const { stdout } = await execFileAsync(runner.file, [...runner.args, runner.script, ...command, "--project-root", runner.projectRoot], {
    timeout,
    windowsHide: true,
    maxBuffer: 8 * 1024 * 1024,
  });
  const payload = JSON.parse(stdout.trim());
  if (!payload.ok) throw new Error(payload.error ?? "Ultralytics command failed.");
  return payload.data;
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
  return String(process.env.ULTRALYTICS_TRAIN_RUNTIME ?? process.env.ULTRALYTICS_TRAINING_RUNTIME ?? "windows").trim().toLowerCase();
}

function runtimeFromName(value: string): UltralyticsRuntimeKind {
  return ["wsl", "wsl-rocm", "rocm-wsl", "rocm"].includes(value) ? "wsl" : "windows";
}

function trainingPythonRunner() {
  const requested = ultralyticsTrainingRuntime();
  if (runtimeFromName(requested) === "wsl") return pythonRunner("wsl");
  if (["windows", "directml", "dml", "cpu"].includes(requested)) return pythonRunner("windows");
  return wslPythonAvailable() ? pythonRunner("wsl") : pythonRunner("windows");
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
