import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const ROOT = path.resolve(process.cwd(), "..");

function candidateAdbPaths() {
  return [
    process.env.ADB_PATH,
    "adb",
    path.join(ROOT, "..", "Downloads", "scrcpy-win64-v4.0", "adb.exe"),
    path.join(process.env.USERPROFILE ?? "", "Downloads", "scrcpy-win64-v4.0", "adb.exe")
  ].filter(Boolean) as string[];
}

export async function resolveAdb() {
  for (const candidate of candidateAdbPaths()) {
    if (candidate === "adb") return candidate;
    if (fs.existsSync(candidate)) return candidate;
  }
  return "adb";
}

export async function getAdbCaptureStatus() {
  const adb = await resolveAdb();
  try {
    const { stdout } = await execFileAsync(adb, ["devices", "-l"], { timeout: 3000, windowsHide: true });
    const devices = stdout.split(/\r?\n/).filter((line) => /\sdevice\s/.test(line));
    return {
      ok: devices.length > 0,
      mode: "adb-native-screencap",
      adb,
      devices,
      message: devices.length ? "ADB device connected. Native still-frame fallback is available." : "No authorized ADB device found."
    };
  } catch (error) {
    return {
      ok: false,
      mode: "adb-native-screencap",
      adb,
      devices: [],
      message: error instanceof Error ? error.message : "ADB status failed."
    };
  }
}

export async function captureAdbPngFrame() {
  const adb = await resolveAdb();
  const startedAt = Date.now();
  const { stdout } = await execFileAsync(adb, ["exec-out", "screencap", "-p"], {
    encoding: "buffer",
    maxBuffer: 32 * 1024 * 1024,
    timeout: 5000,
    windowsHide: true
  });
  return {
    adb,
    buffer: Buffer.from(stdout),
    capturedAt: new Date().toISOString(),
    elapsedMs: Date.now() - startedAt
  };
}
