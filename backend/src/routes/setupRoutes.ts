import type { FastifyInstance } from "fastify";
import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { getAdbCaptureStatus } from "../services/adbFrameSource.js";
import { getNdiDirectStatus } from "../services/ndiDirectSource.js";
import { getNdiToolsStatus } from "../services/ndiTools.js";
import { getNativeObsBridgeStatus } from "../services/nativeObsBridge.js";
import { ensureObsScrcpyPluginInstalled } from "../services/obsPluginInstaller.js";
import { getScrcpyStatus } from "../services/scrcpySource.js";
import { readRuntime } from "../runtime/RuntimeStore.js";
import { getScreenOcrStatus } from "../vision/screenTextRecognition.js";
import { getTimerOcrStatus } from "../vision/timerRecognition.js";
import { getUltralyticsStatus } from "../vision/ultralyticsVision.js";

const ROOT = path.resolve(process.cwd(), "..");

type SetupState = "ready" | "action" | "optional" | "error";
type SetupGroup = "core" | "capture" | "vision" | "desktop";

type SetupCheck = {
  id: string;
  label: string;
  group: SetupGroup;
  state: SetupState;
  summary: string;
  detail: string;
  action?: string;
  optional?: boolean;
  data?: unknown;
};

async function rootPackage() {
  try {
    return JSON.parse(await readFile(path.join(ROOT, "package.json"), "utf8")) as { version?: string };
  } catch {
    return {};
  }
}

async function settled<T>(task: Promise<T>): Promise<{ ok: true; value: T } | { ok: false; error: string }> {
  try {
    return { ok: true, value: await task };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Status check failed." };
  }
}

function errored(id: string, label: string, group: SetupGroup, error: string, optional = false): SetupCheck {
  return {
    id,
    label,
    group,
    state: optional ? "optional" : "error",
    summary: optional ? "Unavailable" : "Check failed",
    detail: error,
    action: optional ? undefined : "Open Settings > Runtime Status and retry after fixing the reported error.",
    optional,
  };
}

function resultError(result: { ok: true; value: unknown } | { ok: false; error: string }) {
  return "error" in result ? result.error : "Status check failed.";
}

function summarize(checks: SetupCheck[]) {
  const required = checks.filter((check) => !check.optional);
  const ready = required.filter((check) => check.state === "ready").length;
  const needsAction = required.filter((check) => check.state === "action" || check.state === "error").length;
  const optional = checks.filter((check) => check.optional);
  const launchReady = needsAction === 0;
  return {
    launchReady,
    requiredReady: ready,
    requiredTotal: required.length,
    optionalReady: optional.filter((check) => check.state === "ready").length,
    optionalTotal: optional.length,
    summary: launchReady
      ? "Desktop alpha setup is ready."
      : `${needsAction} required setup item${needsAction === 1 ? "" : "s"} need attention.`,
  };
}

export async function setupRoutes(app: FastifyInstance) {
  app.get("/api/setup/status", async () => {
    const [pkg, runtime, adb, scrcpy, obs, obsPlugin, ndiTools, ndiDirect, yolo, timerOcr, screenOcr] = await Promise.all([
      rootPackage(),
      settled(readRuntime()),
      settled(getAdbCaptureStatus()),
      settled(Promise.resolve(getScrcpyStatus())),
      settled(Promise.resolve(getNativeObsBridgeStatus())),
      settled(ensureObsScrcpyPluginInstalled()),
      settled(getNdiToolsStatus()),
      settled(Promise.resolve(getNdiDirectStatus())),
      settled(getUltralyticsStatus()),
      settled(getTimerOcrStatus()),
      settled(getScreenOcrStatus()),
    ]);

    const checks: SetupCheck[] = [{
      id: "backend",
      label: "Backend",
      group: "core",
      state: "ready",
      summary: "Online",
      detail: `Fastify is running on ${process.env.HOST ?? "127.0.0.1"}:${process.env.PORT ?? "8787"}.`,
      data: { pid: process.pid },
    }];

    if (runtime.ok) {
      const heroCount = runtime.value?.heroes?.length ?? 0;
      checks.push({
        id: "runtime",
        label: "Runtime Data",
        group: "core",
        state: heroCount > 0 ? "ready" : "action",
        summary: heroCount > 0 ? `${heroCount} heroes loaded` : "Not synced",
        detail: heroCount > 0 ? `Runtime generated at ${runtime.value?.generatedAt ?? "unknown time"}.` : "Official runtime data has not been compiled yet.",
        action: heroCount > 0 ? undefined : "Open Settings > Data Sync, sync official data, then compile runtime data.",
        data: { heroCount, updatedAt: runtime.value?.generatedAt ?? null },
      });
    } else checks.push(errored("runtime", "Runtime Data", "core", resultError(runtime)));

    if (yolo.ok) {
      const ready = Boolean(yolo.value.packageAvailable && yolo.value.modelAvailable);
      checks.push({
        id: "ultralytics",
        label: "YOLO Vision",
        group: "vision",
        state: ready ? "ready" : "action",
        summary: ready ? "Model ready" : "Runtime incomplete",
        detail: ready
          ? `${yolo.value.inferenceBackend?.selected ?? yolo.value.device?.selected ?? "auto"} inference, ${yolo.value.training?.images ?? 0} training images.`
          : "Install the managed CV runtime and prepare/train a model before live CV is dependable.",
        action: ready ? undefined : "Run npm run cv:status, then npm run cv:bootstrap or train the model from CV Lab.",
        data: yolo.value,
      });
    } else checks.push(errored("ultralytics", "YOLO Vision", "vision", resultError(yolo)));

    if (adb.ok) {
      checks.push({
        id: "adb",
        label: "ADB Device",
        group: "capture",
        state: adb.value.ok ? "ready" : "action",
        summary: adb.value.ok ? "Device authorized" : "No device",
        detail: adb.value.message,
        action: adb.value.ok ? undefined : "Connect a phone, enable USB debugging, then accept the ADB authorization prompt.",
        data: adb.value,
      });
    } else checks.push(errored("adb", "ADB Device", "capture", resultError(adb)));

    if (scrcpy.ok) {
      checks.push({
        id: "scrcpy",
        label: "scrcpy Stream",
        group: "capture",
        state: scrcpy.value.ok ? "ready" : "action",
        summary: scrcpy.value.ok ? "Running" : "Stopped",
        detail: scrcpy.value.message ?? "scrcpy is used for realtime H.264 capture.",
        action: scrcpy.value.ok ? undefined : "Open Live Capture, select Backend scrcpy, and start capture after ADB is authorized.",
        data: scrcpy.value,
      });
    } else checks.push(errored("scrcpy", "scrcpy Stream", "capture", resultError(scrcpy)));

    if (obs.ok) {
      checks.push({
        id: "obs",
        label: "OBS Bridge",
        group: "capture",
        state: obs.value.connected ? "ready" : "optional",
        summary: obs.value.connected ? "Receiving frames" : "Waiting",
        detail: obs.value.connected ? `${obs.value.width}x${obs.value.height} frames from ${obs.value.source}.` : "Optional bridge for OBS-integrated capture.",
        optional: true,
        data: obs.value,
      });
    } else checks.push(errored("obs", "OBS Bridge", "capture", resultError(obs), true));

    if (obsPlugin.ok) {
      checks.push({
        id: "obs-plugin",
        label: "OBS Plugin",
        group: "capture",
        state: obsPlugin.value.upToDate ? "ready" : obsPlugin.value.obsInstalled ? "action" : "optional",
        summary: obsPlugin.value.upToDate ? "Installed" : obsPlugin.value.obsInstalled ? "Install needed" : "OBS not found",
        detail: obsPlugin.value.upToDate
          ? `Installed at ${obsPlugin.value.pluginRoot}. Restart OBS after updates.`
          : obsPlugin.value.obsInstalled
            ? obsPlugin.value.action
            : "OBS Studio was not detected, so the native scrcpy source plugin was not installed.",
        action: obsPlugin.value.upToDate ? undefined : obsPlugin.value.action,
        optional: true,
        data: obsPlugin.value,
      });
    } else checks.push(errored("obs-plugin", "OBS Plugin", "capture", resultError(obsPlugin), true));

    if (ndiTools.ok) {
      checks.push({
        id: "ndi",
        label: "NDI Tools",
        group: "capture",
        state: ndiTools.value.installed ? "ready" : "optional",
        summary: ndiTools.value.installed ? "Installed" : "Not installed",
        detail: ndiTools.value.installed ? `Tools root: ${ndiTools.value.toolsRoot}` : "Optional network capture path for NDI sources.",
        optional: true,
        data: { toolsRoot: ndiTools.value.toolsRoot, nativeCapture: ndiTools.value.nativeCapture, direct: ndiDirect.ok ? ndiDirect.value : null },
      });
    } else checks.push(errored("ndi", "NDI Tools", "capture", resultError(ndiTools), true));

    if (timerOcr.ok) {
      checks.push({
        id: "timer-ocr",
        label: "Timer OCR",
        group: "vision",
        state: timerOcr.value.packageAvailable ? "ready" : "optional",
        summary: timerOcr.value.packageAvailable ? "Available" : "Not installed",
        detail: "Optional sidecar OCR for timers and score-shaped regions.",
        optional: true,
        data: timerOcr.value,
      });
    } else checks.push(errored("timer-ocr", "Timer OCR", "vision", resultError(timerOcr), true));

    if (screenOcr.ok) {
      const ready = Boolean(screenOcr.value.packageAvailable || screenOcr.value.paddleAvailable);
      checks.push({
        id: "screen-ocr",
        label: "Screen OCR",
        group: "vision",
        state: ready ? "ready" : "optional",
        summary: ready ? "Available" : "Not installed",
        detail: screenOcr.value.enabledForLiveCapture ? "Live polling is enabled." : "Optional manual OCR is available from CV Lab when installed.",
        optional: true,
        data: screenOcr.value,
      });
    } else checks.push(errored("screen-ocr", "Screen OCR", "vision", resultError(screenOcr), true));

    checks.push({
      id: "desktop",
      label: "Desktop Shell",
      group: "desktop",
      state: process.env.MLBB_ELECTRON ? "ready" : "optional",
      summary: process.env.MLBB_ELECTRON ? "Electron managed" : "Browser/dev mode",
      detail: process.env.MLBB_ELECTRON ? "The backend is being managed by the Electron shell." : "The same setup flow works in browser development mode.",
      optional: true,
      data: { electronManaged: Boolean(process.env.MLBB_ELECTRON) },
    });

    return {
      ok: true,
      version: pkg.version ?? "0.0.0",
      generatedAt: new Date().toISOString(),
      environment: {
        platform: process.platform,
        arch: process.arch,
        release: os.release(),
        node: process.version,
        electronManaged: Boolean(process.env.MLBB_ELECTRON),
        root: ROOT,
      },
      readiness: summarize(checks),
      checks,
    };
  });
}
