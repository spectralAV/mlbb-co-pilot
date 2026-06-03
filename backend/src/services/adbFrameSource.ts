import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const ROOT = path.resolve(process.cwd(), "..");

const defaultRetry = { maxAttempts: 4, baseDelayMs: 250, maxDelayMs: 2000 };

export type AdbCaptureErrorCode = "no_device" | "unauthorized" | "timeout" | "adb_unavailable" | "capture_failed";

export class AdbCaptureError extends Error {
  readonly code: AdbCaptureErrorCode;
  readonly adb: string;
  readonly retryable: boolean;

  constructor(code: AdbCaptureErrorCode, message: string, adb: string, retryable = false) {
    super(message);
    this.name = "AdbCaptureError";
    this.code = code;
    this.adb = adb;
    this.retryable = retryable;
  }
}

function candidateAdbPaths() {
  return [
    process.env.ADB_PATH,
    "adb",
    path.join(ROOT, "..", "Downloads", "scrcpy-win64-v4.0", "adb.exe"),
    path.join(process.env.USERPROFILE ?? "", "Downloads", "scrcpy-win64-v4.0", "adb.exe"),
  ].filter(Boolean) as string[];
}

export async function resolveAdb() {
  for (const candidate of candidateAdbPaths()) {
    if (candidate === "adb") return candidate;
    if (fs.existsSync(candidate)) return candidate;
  }
  return "adb";
}

export function adbRetryDelayMs(attempt: number, baseDelayMs = defaultRetry.baseDelayMs, maxDelayMs = defaultRetry.maxDelayMs) {
  const exponent = Math.max(0, attempt - 1);
  return Math.min(maxDelayMs, baseDelayMs * 2 ** exponent);
}

export function isRetryableAdbError(error: unknown): boolean {
  if (error instanceof AdbCaptureError) return error.retryable;
  const message = String((error as NodeJS.ErrnoException)?.message ?? error ?? "").toLowerCase();
  const code = String((error as NodeJS.ErrnoException)?.code ?? "").toLowerCase();
  if (code === "etimedout" || code === "econnreset" || code === "econnrefused" || code === "ebusy") return true;
  if (message.includes("timed out") || message.includes("timeout")) return true;
  if (message.includes("device offline") || message.includes("not found") || message.includes("no devices")) return true;
  if (message.includes("cannot connect") || message.includes("connection reset")) return true;
  return false;
}

function classifyAdbDevicesError(adb: string, message: string): AdbCaptureError {
  const lower = message.toLowerCase();
  if (lower.includes("unauthorized")) {
    return new AdbCaptureError(
      "unauthorized",
      "ADB device is connected but not authorized. Accept the USB debugging prompt on the phone.",
      adb,
      false,
    );
  }
  if (lower.includes("offline")) {
    return new AdbCaptureError("no_device", "ADB device is offline. Reconnect USB or restart wireless debugging.", adb, true);
  }
  if (lower.includes("no devices") || lower.includes("device not found") || lower.includes("not found")) {
    return new AdbCaptureError("no_device", "No authorized ADB device found. Connect a phone and enable USB debugging.", adb, true);
  }
  if (lower.includes("timed out") || lower.includes("timeout")) {
    return new AdbCaptureError("timeout", "ADB device listing timed out.", adb, true);
  }
  if (lower.includes("enoent") || lower.includes("not recognized") || lower.includes("command not found")) {
    return new AdbCaptureError("adb_unavailable", "ADB executable was not found. Install platform-tools or set ADB_PATH.", adb, false);
  }
  return new AdbCaptureError("capture_failed", message, adb, true);
}

async function listAuthorizedDevices(adb: string) {
  const { stdout } = await execFileAsync(adb, ["devices", "-l"], { timeout: 3000, windowsHide: true });
  return stdout
    .split(/\r?\n/)
    .filter((line) => /\sdevice\s/.test(line))
    .map((line) => line.split(/\s+/)[0])
    .filter(Boolean);
}

function classifyCaptureError(adb: string, error: unknown): AdbCaptureError {
  if (error instanceof AdbCaptureError) return error;
  const err = error as NodeJS.ErrnoException;
  const message = String(err?.message ?? error ?? "ADB frame capture failed.");
  const lower = message.toLowerCase();
  if (err?.code === "ETIMEDOUT" || lower.includes("timed out") || lower.includes("timeout")) {
    return new AdbCaptureError("timeout", "ADB screencap timed out. The device may be busy or disconnected.", adb, true);
  }
  if (lower.includes("device offline") || lower.includes("no devices") || lower.includes("device not found")) {
    return new AdbCaptureError("no_device", "ADB device disconnected during capture.", adb, true);
  }
  if (lower.includes("unauthorized")) {
    return new AdbCaptureError("unauthorized", "ADB device is not authorized for capture.", adb, false);
  }
  if (lower.includes("enoent") || lower.includes("not recognized")) {
    return new AdbCaptureError("adb_unavailable", "ADB executable was not found.", adb, false);
  }
  return new AdbCaptureError("capture_failed", message, adb, isRetryableAdbError(error));
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function getAdbCaptureStatus() {
  const adb = await resolveAdb();
  try {
    const devices = await listAuthorizedDevices(adb);
    return {
      ok: devices.length > 0,
      mode: "adb-native-screencap",
      adb,
      devices,
      message: devices.length ? "ADB device connected. Native still-frame fallback is available." : "No authorized ADB device found.",
    };
  } catch (error) {
    const classified = classifyAdbDevicesError(adb, error instanceof Error ? error.message : "ADB status failed.");
    return {
      ok: false,
      mode: "adb-native-screencap",
      adb,
      devices: [] as string[],
      code: classified.code,
      message: classified.message,
    };
  }
}

export async function captureAdbPngFrame(options?: { maxAttempts?: number; baseDelayMs?: number }) {
  const maxAttempts = Math.max(1, options?.maxAttempts ?? defaultRetry.maxAttempts);
  const baseDelayMs = options?.baseDelayMs ?? defaultRetry.baseDelayMs;
  const adb = await resolveAdb();
  let lastError: AdbCaptureError | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const devices = await listAuthorizedDevices(adb);
      if (!devices.length) {
        throw new AdbCaptureError(
          "no_device",
          "No authorized ADB device found. Connect a phone and enable USB debugging.",
          adb,
          true,
        );
      }
      const startedAt = Date.now();
      const { stdout } = await execFileAsync(adb, ["exec-out", "screencap", "-p"], {
        encoding: "buffer",
        maxBuffer: 32 * 1024 * 1024,
        timeout: 5000,
        windowsHide: true,
      });
      const buffer = Buffer.from(stdout);
      if (!buffer.length) {
        throw new AdbCaptureError("capture_failed", "ADB screencap returned an empty frame.", adb, true);
      }
      return {
        adb,
        buffer,
        capturedAt: new Date().toISOString(),
        elapsedMs: Date.now() - startedAt,
        attempt,
      };
    } catch (error) {
      lastError = classifyCaptureError(adb, error);
      if (attempt >= maxAttempts || !lastError.retryable) break;
      const delayMs = adbRetryDelayMs(attempt, baseDelayMs);
      await sleep(delayMs);
    }
  }

  throw lastError ?? new AdbCaptureError("capture_failed", "ADB frame capture failed.", adb, false);
}
