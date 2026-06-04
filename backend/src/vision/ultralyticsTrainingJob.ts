import { execFile, spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync } from "node:fs";
import { access, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import {
  assertTrainingAccelerator,
  getUltralyticsStatus,
  resolveTrainingBaseModel,
  runJson,
  shutdownWorker,
  trainingPythonRunner,
  ultralyticsProjectRoot,
  wslDistro,
  wslPath,
  wslPython,
} from "./ultralyticsVision.js";

const execFileAsync = promisify(execFile);

export type UltralyticsTrainingJobState =
  | "idle"
  | "starting"
  | "training"
  | "validating"
  | "exporting"
  | "mirroring"
  | "cleanup"
  | "completed"
  | "failed"
  | "stuck"
  | "killed";

export type WslProcessProbe = {
  distro: string;
  python: string;
  linuxPids: number[];
  processes: Array<{
    pid: number;
    cwd: string | null;
    cmdline: string | null;
    children: Array<{ pid: number; cmdline: string | null }>;
  }>;
};

export type UltralyticsTrainingJob = {
  id: string;
  state: UltralyticsTrainingJobState;
  command: string[];
  cwd: string;
  trainingScope: "full" | "correction";
  runName: string;
  artifactPaths: {
    weights: string;
    onnx: string;
    runDir: string;
    bestWeights: string;
    lastWeights: string;
  };
  stagedWorkspace: string | null;
  runPath: string | null;
  statusFile: string;
  startedAt: string | null;
  updatedAt: string;
  elapsedMs: number;
  pid: number | null;
  childPids: number[];
  runtime: "windows" | "wsl";
  trainingPython: string;
  wsl?: WslProcessProbe;
  device?: unknown;
  error: string | null;
  exitCode: number | null;
  signal: string | null;
  artifactsReady: boolean;
  stuckReason: string | null;
  result: unknown | null;
};

export type UltralyticsTrainingStartOptions = {
  epochs?: number;
  imageSize?: number;
  baseModel?: string;
  device?: string;
  batch?: number;
  workers?: number;
  amp?: boolean;
  trainingScope?: string;
  recentLimit?: number;
  repeatManual?: number;
};

const cvRoot = path.join(ultralyticsProjectRoot, "data", "cv");
const runtimeDir = path.join(cvRoot, "runtime");
const weightsPath = path.join(cvRoot, "models", "mlbb-detect.pt");
const onnxPath = path.join(cvRoot, "models", "mlbb-detect.onnx");
const runsRoot = path.join(cvRoot, "runs");
const script = path.join(ultralyticsProjectRoot, "backend", "tools", "ultralyticsVision.py");
const defaultStatusFilePath = path.join(runtimeDir, "training-job.json");
const defaultPhaseFilePath = path.join(runtimeDir, "training-job-phase.json");

type TrainingJobTestOverrides = {
  statusFilePath?: string;
  phaseFilePath?: string;
  probeWslProcesses?: (jobId: string) => Promise<WslProcessProbe | undefined>;
  killWslTrainingTree?: (jobId: string) => Promise<void>;
};

let trainingJobTestOverrides: TrainingJobTestOverrides = {};

function statusFilePath() {
  return trainingJobTestOverrides.statusFilePath ?? defaultStatusFilePath;
}

function phaseFilePath() {
  return trainingJobTestOverrides.phaseFilePath ?? defaultPhaseFilePath;
}

export function setUltralyticsTrainingJobTestOverrides(overrides: TrainingJobTestOverrides | null) {
  trainingJobTestOverrides = overrides ?? {};
}

export function resetUltralyticsTrainingJobForTest() {
  currentJob = idleJob();
  activeChild = null;
  stopPolling();
  trainingJobTestOverrides = {};
}

const ACTIVE_STATES = new Set<UltralyticsTrainingJobState>([
  "starting",
  "training",
  "validating",
  "exporting",
  "mirroring",
  "cleanup",
]);

const TERMINAL_STATES = new Set<UltralyticsTrainingJobState>([
  "completed",
  "failed",
  "stuck",
  "killed",
]);

export const STUCK_WITH_ARTIFACTS_MS = Number(process.env.MLBB_TRAINING_STUCK_MS ?? 5 * 60 * 1000);
const POLL_INTERVAL_MS = 2000;

let currentJob: UltralyticsTrainingJob | null = null;
let pollTimer: NodeJS.Timeout | null = null;
let activeChild: ChildProcessWithoutNullStreams | null = null;

function idleJob(): UltralyticsTrainingJob {
  const now = new Date().toISOString();
  return {
    id: "",
    state: "idle",
    command: [],
    cwd: ultralyticsProjectRoot,
    trainingScope: "full",
    runName: "mlbb-detection",
    artifactPaths: artifactPaths("full"),
    stagedWorkspace: null,
    runPath: null,
    statusFile: statusFilePath(),
    startedAt: null,
    updatedAt: now,
    elapsedMs: 0,
    pid: null,
    childPids: [],
    runtime: trainingRuntimeHint(),
    trainingPython: trainingPythonHint(),
    error: null,
    exitCode: null,
    signal: null,
    artifactsReady: false,
    stuckReason: null,
    result: null,
  };
}

// Cheap env-only runtime hints. Never spawns subprocesses, so the status endpoint
// and the 2s poll loop cannot block the event loop on wsl.exe/python probes.
function trainingRuntimeHint(): "windows" | "wsl" {
  const value = String(
    process.env.ULTRALYTICS_TRAIN_RUNTIME ??
      process.env.ULTRALYTICS_TRAINING_RUNTIME ??
      process.env.ULTRALYTICS_RUNTIME ??
      "",
  )
    .trim()
    .toLowerCase();
  if (["wsl", "wsl-rocm", "rocm-wsl", "rocm"].includes(value)) return "wsl";
  if (["windows", "win", "cuda", "directml", "dml", "amd", "amd-gpu"].includes(value)) return "windows";
  return "wsl";
}

function trainingPythonHint(): string {
  if (trainingRuntimeHint() === "wsl") {
    return String(process.env.ULTRALYTICS_WSL_PYTHON ?? "wsl:~/.mlbb-copilot/cv-rocm/bin/python");
  }
  return String(process.env.ULTRALYTICS_PYTHON ?? "python");
}

function artifactPaths(scope: "full" | "correction") {
  const runName = scope === "correction" ? "mlbb-correction" : "mlbb-detection";
  const runDir = path.join(runsRoot, runName);
  return {
    weights: weightsPath,
    onnx: onnxPath,
    runDir,
    bestWeights: path.join(runDir, "weights", "best.pt"),
    lastWeights: path.join(runDir, "weights", "last.pt"),
  };
}

export function trainingJobIsActive(state: UltralyticsTrainingJobState) {
  return ACTIVE_STATES.has(state);
}

export function canStartUltralyticsTraining(job: UltralyticsTrainingJob | null) {
  if (!job || job.state === "idle") return true;
  return TERMINAL_STATES.has(job.state);
}

export type RehydratedTrainingJobResolution =
  | { action: "idle" }
  | { action: "restore"; resumePolling: boolean }
  | { action: "finalize"; state: "completed" | "failed"; error: string | null };

export function resolveRehydratedTrainingJob(
  job: UltralyticsTrainingJob,
  options: {
    wslProcessCount: number;
    artifactsReady: boolean;
    pythonState?: UltralyticsTrainingJobState | null;
  },
): RehydratedTrainingJobResolution {
  if (!job.id || job.state === "idle") return { action: "idle" };
  if (TERMINAL_STATES.has(job.state)) {
    return { action: "restore", resumePolling: job.state === "stuck" };
  }
  if (!trainingJobIsActive(job.state)) {
    return { action: "restore", resumePolling: false };
  }

  const wslAlive = job.runtime === "wsl" && options.wslProcessCount > 0;
  if (wslAlive) {
    return { action: "restore", resumePolling: true };
  }

  if (options.pythonState === "completed" && options.artifactsReady) {
    return { action: "finalize", state: "completed", error: null };
  }
  if (options.pythonState === "failed") {
    return {
      action: "finalize",
      state: "failed",
      error: "Training failed before the backend restarted.",
    };
  }

  return {
    action: "finalize",
    state: "failed",
    error:
      "Backend restarted while no training process was found for this job. Stop is not required; start a new training run.",
  };
}

function normalizePersistedJob(raw: unknown): UltralyticsTrainingJob | null {
  if (!raw || typeof raw !== "object") return null;
  const snapshot = raw as Partial<UltralyticsTrainingJob>;
  if (!snapshot.id || typeof snapshot.id !== "string") return null;
  const base = idleJob();
  const trainingScope = snapshot.trainingScope === "correction" ? "correction" : "full";
  return {
    ...base,
    ...snapshot,
    trainingScope,
    artifactPaths: {
      ...artifactPaths(trainingScope),
      ...(snapshot.artifactPaths ?? {}),
    },
    statusFile: statusFilePath(),
    pid: null,
    childPids: Array.isArray(snapshot.childPids) ? snapshot.childPids : [],
  };
}

export function detectStuckWithArtifacts(
  job: Pick<UltralyticsTrainingJob, "state" | "artifactsReady" | "startedAt" | "elapsedMs">,
  now = Date.now(),
  timeoutMs = STUCK_WITH_ARTIFACTS_MS,
) {
  if (!trainingJobIsActive(job.state) || !job.artifactsReady || !job.startedAt) {
    return { stuck: false as const };
  }
  const elapsed = job.elapsedMs || now - Date.parse(job.startedAt);
  if (elapsed < timeoutMs) return { stuck: false as const };
  return {
    stuck: true as const,
    reason: "Training artifacts are present but the training process is still running.",
  };
}

export function applyProcessExit(
  job: UltralyticsTrainingJob,
  code: number | null,
  signal: string | null,
): UltralyticsTrainingJobState {
  if (job.state === "killed") return "killed";
  if (job.state === "stuck") return "stuck";
  if (code === 0) return "completed";
  return "failed";
}

export function buildWslKillCommand(distro: string, jobId: string) {
  const safeId = jobId.replace(/[^a-zA-Z0-9_-]/g, "");
  // The leading character class ([u]/[p]) prevents pgrep/pkill from matching the
  // bash process that runs this very script (its argv contains the pattern text).
  // Direct pkill is used instead of `pids=$(pgrep ...)` because command substitution
  // inside an inline `bash -c` script does not match reliably under WSL.
  return [
    "bash",
    "-c",
    [
      `pkill -TERM -f "[u]ltralyticsVision.py train.*--job-id ${safeId}" 2>/dev/null`,
      "sleep 1",
      `pkill -KILL -f "[u]ltralyticsVision.py train.*--job-id ${safeId}" 2>/dev/null`,
      'pkill -KILL -f "[p]t_data_worker" 2>/dev/null',
      "true",
    ].join("\n"),
  ];
}

export function parseWslProcessProbe(output: string, distro: string, python: string): WslProcessProbe {
  const processes: WslProcessProbe["processes"] = [];
  let current: WslProcessProbe["processes"][number] | null = null;
  for (const line of output.split(/\r?\n/)) {
    if (line.startsWith("PID=")) {
      if (current) processes.push(current);
      current = { pid: Number(line.slice(4)), cwd: null, cmdline: null, children: [] };
      continue;
    }
    if (!current) continue;
    if (line.startsWith("CWD=")) current.cwd = line.slice(4) || null;
    else if (line.startsWith("CMD=")) current.cmdline = line.slice(4) || null;
    else if (line.startsWith("CHILD=")) {
      const [pidText, ...cmdParts] = line.slice(6).split("|");
      current.children.push({ pid: Number(pidText), cmdline: cmdParts.join("|") || null });
    }
  }
  if (current) processes.push(current);
  return {
    distro,
    python,
    linuxPids: processes.map((entry) => entry.pid),
    processes,
  };
}

function newJobId() {
  return `train-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function mergeJob(patch: Partial<UltralyticsTrainingJob>) {
  if (!currentJob) currentJob = idleJob();
  const previousState = currentJob.state;
  const startedAt = currentJob.startedAt ?? patch.startedAt ?? null;
  const now = Date.now();
  currentJob = {
    ...currentJob,
    ...patch,
    updatedAt: patch.updatedAt ?? new Date().toISOString(),
    elapsedMs: startedAt ? now - Date.parse(startedAt) : 0,
  };
  if (patch.state && patch.state !== previousState) {
    console.info(JSON.stringify({
      event: "training_state",
      jobId: currentJob.id,
      state: currentJob.state,
      previousState,
    }));
  }
  return currentJob;
}

async function persistJobSnapshot() {
  if (!currentJob) return;
  await mkdirSafe(runtimeDir);
  await writeFile(statusFilePath(), `${JSON.stringify(currentJob, null, 2)}\n`, "utf8");
}

async function mkdirSafe(dir: string) {
  try {
    await access(dir);
  } catch {
    const { mkdir } = await import("node:fs/promises");
    await mkdir(dir, { recursive: true });
  }
}

async function readPythonPhaseFile(): Promise<Partial<UltralyticsTrainingJob> | null> {
  try {
    const raw = await readFile(phaseFilePath(), "utf8");
    const payload = JSON.parse(raw) as {
      pythonState?: UltralyticsTrainingJobState;
      stagedWorkspace?: string | null;
      runPath?: string | null;
      result?: unknown;
    };
    if (!payload?.pythonState) return null;
    return {
      state: payload.pythonState,
      stagedWorkspace: payload.stagedWorkspace ?? null,
      runPath: payload.runPath ?? null,
      ...(payload.result ? { result: payload.result } : {}),
    };
  } catch {
    return null;
  }
}

async function artifactsAreReady(job: UltralyticsTrainingJob) {
  const candidates = [job.artifactPaths.bestWeights, job.artifactPaths.lastWeights, job.artifactPaths.weights];
  const startedAt = job.startedAt ? Date.parse(job.startedAt) : 0;
  for (const file of candidates) {
    try {
      const info = await stat(file);
      if (startedAt > 0 && info.mtimeMs >= startedAt - 1000) return true;
      if (!startedAt && info.size > 0) return true;
    } catch {
      // continue
    }
  }
  return false;
}

export function parsePgrepAfOutput(output: string, distro: string, python: string): WslProcessProbe {
  const processes: WslProcessProbe["processes"] = [];
  for (const raw of output.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const match = /^(\d+)\s+(.*)$/.exec(line);
    if (!match) continue;
    processes.push({ pid: Number(match[1]), cwd: null, cmdline: match[2] || null, children: [] });
  }
  return {
    distro,
    python,
    linuxPids: processes.map((entry) => entry.pid),
    processes,
  };
}

async function probeWslProcesses(jobId: string): Promise<WslProcessProbe | undefined> {
  if (trainingJobTestOverrides.probeWslProcesses) {
    return trainingJobTestOverrides.probeWslProcesses(jobId);
  }
  const distro = wslDistro();
  const python = wslPython();
  const safeId = jobId.replace(/[^a-zA-Z0-9_-]/g, "");
  // Direct `pgrep -af` (no command substitution, no awk, no $-vars) so nothing is
  // mangled crossing the wsl.exe arg boundary. The leading [u] character class stops
  // pgrep from matching the bash that runs this script. DataLoader workers share the
  // --job-id argv, so they each appear as their own "PID cmdline" output line.
  const script = `pgrep -af "[u]ltralyticsVision.py train.*--job-id ${safeId}" 2>/dev/null || true`;
  try {
    const { stdout } = await execFileAsync("wsl.exe", ["-d", distro, "--", "bash", "-c", script], {
      windowsHide: true,
      timeout: 15000,
      maxBuffer: 1024 * 1024,
    });
    return parsePgrepAfOutput(String(stdout ?? ""), distro, python);
  } catch {
    return { distro, python, linuxPids: [], processes: [] };
  }
}

function isProcessAlive(child: ChildProcessWithoutNullStreams | null) {
  return Boolean(child && child.exitCode === null && child.signalCode === null && !child.killed);
}

async function killWindowsProcessTree(pid: number) {
  if (process.platform === "win32") {
    try {
      await execFileAsync("taskkill", ["/PID", String(pid), "/T", "/F"], { windowsHide: true, timeout: 30000 });
    } catch (error) {
      // The launcher (e.g. wsl.exe) often exits on its own once its child tree is
      // killed, so taskkill reporting "process not found" is success, not an error.
      const message = error instanceof Error ? error.message : String(error);
      if (!/not found|128/i.test(message)) throw error;
    }
    return;
  }
  try {
    process.kill(pid, "SIGKILL");
  } catch {
    // ignore
  }
}

async function killWslTrainingTree(jobId: string) {
  const distro = wslDistro();
  await execFileAsync("wsl.exe", ["-d", distro, "--", ...buildWslKillCommand(distro, jobId)], {
    windowsHide: true,
    timeout: 30000,
    maxBuffer: 1024 * 1024,
  });
}

function buildTrainingArgs(
  options: UltralyticsTrainingStartOptions,
  runner: ReturnType<typeof trainingPythonRunner>,
  baseModel: string,
  jobId: string,
) {
  const trainingScope = options.trainingScope === "correction" ? "correction" : "full";
  const defaultWorkers = runner.runtime === "wsl" ? 2 : 0;
  return [
    "train",
    "--base-model",
    baseModel,
    "--epochs",
    String(Math.max(1, Number(options.epochs ?? 60))),
    "--image-size",
    String(Math.max(320, Number(options.imageSize ?? 960))),
    "--batch",
    String(Math.max(1, Number(options.batch ?? 4))),
    "--workers",
    String(Math.max(0, Number(options.workers ?? defaultWorkers))),
    "--amp",
    String(Boolean(options.amp ?? false)),
    "--device",
    String(options.device ?? process.env.ULTRALYTICS_DEVICE ?? "auto").trim() || "auto",
    "--training-scope",
    trainingScope,
    "--recent-limit",
    String(Math.max(1, Number(options.recentLimit ?? 32))),
    "--repeat-manual",
    String(Math.max(1, Number(options.repeatManual ?? 8))),
    "--job-id",
    jobId,
    "--status-file",
    runner.runtime === "wsl" ? wslPath(phaseFilePath()) : phaseFilePath(),
  ];
}

async function buildLaunchCommand(options: UltralyticsTrainingStartOptions, jobId: string) {
  const runner = trainingPythonRunner();
  if (runner.runtime === "windows" && !existsSync(runner.python)) {
    throw new Error("Install the Ultralytics runtime before training.");
  }
  const status = await runJson(["status", "--device", String(options.device ?? process.env.ULTRALYTICS_DEVICE ?? "auto").trim() || "auto"], 20000, runner);
  assertTrainingAccelerator(status.device);
  const resolvedBaseModel = await resolveTrainingBaseModel(options.baseModel);
  const baseModel = runner.runtime === "wsl" && path.isAbsolute(resolvedBaseModel) ? wslPath(resolvedBaseModel) : resolvedBaseModel;
  const trainingScope: "full" | "correction" = options.trainingScope === "correction" ? "correction" : "full";
  const trainArgs = buildTrainingArgs(options, runner, baseModel, jobId);
  const command = [runner.file, ...runner.args, runner.script, ...trainArgs, "--project-root", runner.projectRoot];
  return { runner, command, trainArgs, trainingScope, device: status.device };
}

function stopPolling() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
}

function startPolling() {
  stopPolling();
  pollTimer = setInterval(() => {
    void pollTrainingJob();
  }, POLL_INTERVAL_MS);
}

async function pollTrainingJob() {
  if (!currentJob || !trainingJobIsActive(currentJob.state)) {
    stopPolling();
    return;
  }

  const pythonStatus = await readPythonPhaseFile();
  const artifactsReady = await artifactsAreReady(currentJob);
  let childPids: number[] = [];
  let wsl: WslProcessProbe | undefined;

  if (currentJob.runtime === "wsl" && currentJob.id) {
    wsl = await probeWslProcesses(currentJob.id);
    childPids = wsl.linuxPids;
    for (const proc of wsl.processes) {
      childPids.push(...proc.children.map((child) => child.pid));
    }
  }

  const alive = isProcessAlive(activeChild);
  const stuckCheck = detectStuckWithArtifacts(
    {
      state: currentJob.state,
      artifactsReady,
      startedAt: currentJob.startedAt,
      elapsedMs: currentJob.elapsedMs,
    },
    Date.now(),
  );


  if (alive && stuckCheck.stuck) {
    mergeJob({
      state: "stuck",
      artifactsReady,
      stuckReason: stuckCheck.reason ?? null,
      childPids,
      wsl,
      ...(pythonStatus ?? {}),
    });
    await persistJobSnapshot();
    return;
  }

  const wslAlive = currentJob.runtime === "wsl" && (wsl?.linuxPids?.length ?? 0) > 0;

  if (!alive && trainingJobIsActive(currentJob.state) && wslAlive) {
    mergeJob({
      artifactsReady,
      childPids,
      wsl,
      pid: null,
      ...(pythonStatus ?? {}),
    });
    await persistJobSnapshot();
    return;
  }

  if (!alive && trainingJobIsActive(currentJob.state)) {
    const exitCode = activeChild?.exitCode ?? currentJob.exitCode;
    const signal = activeChild?.signalCode ?? currentJob.signal;
    const nextState = applyProcessExit(currentJob, exitCode, signal);
    if (nextState === "completed") {
      await finalizeCompletedTraining(exitCode, signal);
    } else {
      mergeJob({
        state: nextState,
        exitCode,
        signal,
        error: currentJob.error ?? (nextState === "failed" ? "Training process exited before reporting completion." : null),
        artifactsReady,
        childPids,
        wsl,
      });
      stopPolling();
      await persistJobSnapshot();
    }
    return;
  }

  mergeJob({
    artifactsReady,
    childPids,
    wsl,
    pid: activeChild?.pid ?? currentJob.pid,
    ...(pythonStatus ?? {}),
  });
  await persistJobSnapshot();
}

async function finalizeCompletedTraining(exitCode: number | null, signal: string | null) {
  if (!currentJob) return;
  try {
    const runner = trainingPythonRunner();
    let result: unknown = currentJob.result ?? null;
    const phase = await readPythonPhaseFile();
    if (phase?.result) result = phase.result;
    if (!result) {
      result = await runJson(["status", "--device", process.env.ULTRALYTICS_DEVICE ?? "auto"], 20000, runner);
    }
    shutdownWorker("Ultralytics model was retrained; reloading weights.");
    mergeJob({
      state: "completed",
      exitCode,
      signal,
      error: null,
      result,
      artifactsReady: true,
    });
  } catch (error) {
    mergeJob({
      state: "failed",
      exitCode,
      signal,
      error: error instanceof Error ? error.message : "Training completed but final status could not be read.",
    });
  }
  stopPolling();
  activeChild = null;
  await persistJobSnapshot();
}

function parseTrainingStdout(stdout: string) {
  const lines = stdout.trim().split(/\r?\n/).reverse();
  for (const line of lines) {
    const text = line.trim();
    if (!text.startsWith("{") || !text.endsWith("}")) continue;
    try {
      const payload = JSON.parse(text) as { ok?: boolean; data?: unknown; error?: string };
      if (payload.ok && payload.data) return payload.data;
      if (!payload.ok) throw new Error(payload.error ?? "Training failed.");
    } catch (error) {
      if (error instanceof Error && error.message !== "Training failed.") throw error;
    }
  }
  return null;
}

function attachChildHandlers(child: ChildProcessWithoutNullStreams, jobId: string) {
  let stdout = "";
  child.stdout.on("data", (chunk) => {
    stdout += String(chunk);
  });
  child.stderr.on("data", (chunk) => {
    stdout += String(chunk);
  });
  child.on("exit", (code, signal) => {
    if (!currentJob || currentJob.id !== jobId) return;
    const parsed = parseTrainingStdout(stdout);
    if (parsed) mergeJob({ result: parsed });
    mergeJob({ exitCode: code, signal });
    void pollTrainingJob();
  });
  child.on("error", (error) => {
    mergeJob({ state: "failed", error: error.message });
    stopPolling();
    void persistJobSnapshot();
  });
}

export function getUltralyticsTrainingStatus() {
  if (!currentJob) return idleJob();
  const startedAt = currentJob.startedAt;
  const wslAlive = currentJob.runtime === "wsl" && (currentJob.wsl?.linuxPids?.length ?? 0) > 0;
  return {
    ...currentJob,
    elapsedMs: startedAt ? Date.now() - Date.parse(startedAt) : 0,
    processAlive: isProcessAlive(activeChild) || wslAlive,
    rehydrated: Boolean(currentJob.id && !isProcessAlive(activeChild) && wslAlive),
  };
}

export async function rehydrateUltralyticsTrainingJob() {
  activeChild = null;
  stopPolling();
  let snapshot: UltralyticsTrainingJob | null = null;
  try {
    const raw = await readFile(statusFilePath(), "utf8");
    snapshot = normalizePersistedJob(JSON.parse(raw));
  } catch {
    currentJob = idleJob();
    return getUltralyticsTrainingStatus();
  }
  if (!snapshot) {
    currentJob = idleJob();
    return getUltralyticsTrainingStatus();
  }

  currentJob = snapshot;
  const wsl =
    snapshot.runtime === "wsl" && snapshot.id && trainingJobIsActive(snapshot.state)
      ? await probeWslProcesses(snapshot.id)
      : snapshot.wsl;
  const artifactsReady = await artifactsAreReady(snapshot);
  const phase = await readPythonPhaseFile();
  const resolution = resolveRehydratedTrainingJob(snapshot, {
    wslProcessCount: wsl?.linuxPids?.length ?? 0,
    artifactsReady,
    pythonState: phase?.state ?? null,
  });

  if (resolution.action === "idle") {
    currentJob = idleJob();
    return getUltralyticsTrainingStatus();
  }

  if (resolution.action === "finalize") {
    if (resolution.state === "completed") {
      await finalizeCompletedTraining(snapshot.exitCode, snapshot.signal);
    } else {
      mergeJob({
        state: "failed",
        error: resolution.error,
        artifactsReady,
        wsl,
        pid: null,
        childPids: wsl?.linuxPids ?? [],
      });
      stopPolling();
      await persistJobSnapshot();
    }
    return getUltralyticsTrainingStatus();
  }

  mergeJob({
    artifactsReady,
    wsl,
    pid: null,
    childPids: wsl?.linuxPids ?? [],
    ...(phase ?? {}),
  });
  if (resolution.resumePolling) startPolling();
  await persistJobSnapshot();
  return getUltralyticsTrainingStatus();
}

export async function startUltralyticsTrainingJob(options: UltralyticsTrainingStartOptions = {}) {
  if (!canStartUltralyticsTraining(currentJob)) {
    throw new Error("A training job is already running. Stop it before starting another.");
  }

  const jobId = newJobId();
  const startedAt = new Date().toISOString();
  let launch: Awaited<ReturnType<typeof buildLaunchCommand>>;
  try {
    launch = await buildLaunchCommand(options, jobId);
  } catch (error) {
    throw error;
  }
  const runName = launch.trainingScope === "correction" ? "mlbb-correction" : "mlbb-detection";

  currentJob = {
    ...idleJob(),
    id: jobId,
    state: "starting",
    command: launch.command,
    cwd: launch.runner.runtime === "wsl" ? launch.runner.projectRoot : ultralyticsProjectRoot,
    trainingScope: launch.trainingScope,
    runName,
    artifactPaths: artifactPaths(launch.trainingScope),
    runPath: path.join(runsRoot, runName),
    startedAt,
    runtime: launch.runner.runtime,
    trainingPython: launch.runner.python,
    device: launch.device,
  };
  await mkdirSafe(runtimeDir);
  try {
    const { unlink } = await import("node:fs/promises");
    await unlink(phaseFilePath()).catch(() => undefined);
  } catch {
    // ignore
  }
  await persistJobSnapshot();

  const child = spawn(launch.runner.file, [...launch.runner.args, launch.runner.script, ...launch.trainArgs, "--project-root", launch.runner.projectRoot], {
    cwd: launch.runner.runtime === "windows" ? ultralyticsProjectRoot : undefined,
    windowsHide: true,
    env: {
      ...process.env,
      MLBB_TRAINING_JOB_ID: jobId,
      MLBB_TRAINING_STATUS_FILE: statusFilePath(),
    },
  });
  activeChild = child;
  mergeJob({ pid: child.pid ?? null });
  attachChildHandlers(child, jobId);
  startPolling();
  await persistJobSnapshot();
  return getUltralyticsTrainingStatus();
}

export async function stopUltralyticsTrainingJob() {
  if (!currentJob || currentJob.state === "idle") {
    return getUltralyticsTrainingStatus();
  }
  if (!trainingJobIsActive(currentJob.state) && currentJob.state !== "stuck") {
    return getUltralyticsTrainingStatus();
  }

  const jobId = currentJob.id;
  const runtime = currentJob.runtime;
  mergeJob({ state: "killed", error: null, stuckReason: null });
  try {
    if (currentJob.runtime === "wsl" && jobId) {
      if (trainingJobTestOverrides.killWslTrainingTree) {
        await trainingJobTestOverrides.killWslTrainingTree(jobId);
      } else {
        await killWslTrainingTree(jobId);
      }
    }
    if (activeChild?.pid) await killWindowsProcessTree(activeChild.pid);
    else if (activeChild && !activeChild.killed) activeChild.kill("SIGKILL");
  } catch (error) {
    mergeJob({ error: error instanceof Error ? error.message : "Stop training failed." });
  }
  activeChild = null;
  stopPolling();
  await persistJobSnapshot();
  return getUltralyticsTrainingStatus();
}

export async function waitForUltralyticsTrainingJob(jobId: string, timeoutMs = 24 * 60 * 60 * 1000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const job = getUltralyticsTrainingStatus();
    if (job.id !== jobId) throw new Error("Training job was replaced before completion.");
    if (job.state === "completed") return job.result ?? (await getUltralyticsStatus());
    if (job.state === "failed" || job.state === "killed") {
      throw new Error(job.error ?? `Training ${job.state}.`);
    }
    if (job.state === "stuck") {
      throw new Error(job.stuckReason ?? "Training is stuck with artifacts present. Stop the process and retry.");
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
  throw new Error("Training timed out before completion.");
}

export async function exportUltralyticsOnnx() {
  const job = getUltralyticsTrainingStatus();
  if (trainingJobIsActive(job.state)) {
    throw new Error("Wait for the active training job to finish before exporting ONNX.");
  }
  const runner = trainingPythonRunner();
  return runJson(["export-onnx"], 30 * 60 * 1000, runner);
}
