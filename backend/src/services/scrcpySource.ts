import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(process.cwd(), "..");

let scrcpyProcess: ChildProcessWithoutNullStreams | null = null;
let startedAt: string | null = null;
let lastExit: { code: number | null; signal: NodeJS.Signals | null; at: string } | null = null;
let lastError = "";

function candidateScrcpyPaths() {
  return [
    process.env.SCRCPY_PATH,
    path.join(ROOT, "..", "Downloads", "scrcpy-win64-v4.0", "scrcpy.exe"),
    path.join(process.env.USERPROFILE ?? "", "Downloads", "scrcpy-win64-v4.0", "scrcpy.exe"),
    "scrcpy"
  ].filter(Boolean) as string[];
}

export function resolveScrcpy() {
  for (const candidate of candidateScrcpyPaths()) {
    if (candidate === "scrcpy") return candidate;
    if (fs.existsSync(candidate)) return candidate;
  }
  return "scrcpy";
}

export function getScrcpyStatus() {
  return {
    ok: Boolean(scrcpyProcess && !scrcpyProcess.killed),
    mode: "scrcpy-native",
    scrcpy: resolveScrcpy(),
    pid: scrcpyProcess?.pid ?? null,
    startedAt,
    lastExit,
    lastError,
    message: scrcpyProcess && !scrcpyProcess.killed ? "scrcpy native mirror is running." : "scrcpy native mirror is stopped."
  };
}

export function startScrcpy(options: any = {}) {
  if (scrcpyProcess && !scrcpyProcess.killed) return getScrcpyStatus();
  const scrcpy = resolveScrcpy();
  const args = [
    "--window-title=MLBB Co-Pilot scrcpy",
    "--video-codec=h264",
    `--video-bit-rate=${String(options.videoBitRate ?? "16M")}`,
    `--max-fps=${String(options.maxFps ?? 60)}`,
    "--no-audio",
    "--stay-awake"
  ];
  if (options.turnScreenOff) args.push("--turn-screen-off");
  lastError = "";
  lastExit = null;
  scrcpyProcess = spawn(scrcpy, args, { windowsHide: false });
  startedAt = new Date().toISOString();
  scrcpyProcess.stderr.on("data", (data) => {
    lastError = String(data).trim().slice(-2000);
  });
  scrcpyProcess.on("error", (error) => {
    lastError = error.message;
  });
  scrcpyProcess.on("exit", (code, signal) => {
    lastExit = { code, signal, at: new Date().toISOString() };
    scrcpyProcess = null;
    startedAt = null;
  });
  return getScrcpyStatus();
}

export function stopScrcpy() {
  if (scrcpyProcess && !scrcpyProcess.killed) scrcpyProcess.kill();
  scrcpyProcess = null;
  startedAt = null;
  return getScrcpyStatus();
}
