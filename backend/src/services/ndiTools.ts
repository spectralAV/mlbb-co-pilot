import { access } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

type NDIToolKey = "launcher" | "studioMonitor" | "testPatterns" | "screenCapture" | "webcam" | "accessManager";

const defaultToolsRoot = "C:\\Program Files\\NDI\\NDI 6 Tools";
const toolRelativePaths: Record<NDIToolKey, string> = {
  launcher: "NDI Launcher.exe",
  studioMonitor: "Studio Monitor\\Application.Network.StudioMonitor.x64.exe",
  testPatterns: "Test Patterns\\Application.Network.TestPatterns.exe",
  screenCapture: "Screen Capture\\Application.Network.ScanConverter2.x64.exe",
  webcam: "Webcam\\Webcam.exe",
  accessManager: "Access Manager\\Application.NdiGroupEditor.exe",
};

const runtimeDllCandidates = [
  "Runtime\\Processing.NDI.Lib.x64.dll",
  "Router\\Processing.NDI.Lib.x64.dll",
  "Bridge\\Processing.NDI.Lib.Advanced.x64.dll",
  "Test Patterns\\Processing.NDI.Lib.Advanced.x64.dll",
];

async function exists(file: string) {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

function toolsRoot() {
  return process.env.NDI_TOOLS_DIR || defaultToolsRoot;
}

function toolPath(tool: NDIToolKey) {
  return path.join(toolsRoot(), toolRelativePaths[tool]);
}

async function resolveRuntime() {
  const configuredDir = process.env.NDI_RUNTIME_DIR_V6 || process.env.NDI_RUNTIME_DIR_V5 || "";
  const configuredDll = configuredDir ? path.join(configuredDir, "Processing.NDI.Lib.x64.dll") : "";
  if (configuredDll && await exists(configuredDll)) {
    return { runtimeDir: configuredDir, runtimeDll: configuredDll, runtimeAvailable: true };
  }
  const root = toolsRoot();
  for (const relative of runtimeDllCandidates) {
    const candidate = path.join(root, relative);
    if (await exists(candidate)) {
      return { runtimeDir: path.dirname(candidate), runtimeDll: candidate, runtimeAvailable: true };
    }
  }
  return {
    runtimeDir: configuredDir,
    runtimeDll: "",
    runtimeAvailable: configuredDir ? await exists(configuredDir) : false,
  };
}

export async function getNdiToolsStatus() {
  const root = toolsRoot();
  const tools = Object.fromEntries(await Promise.all((Object.keys(toolRelativePaths) as NDIToolKey[]).map(async (key) => {
    const resolved = toolPath(key);
    return [key, { path: resolved, available: await exists(resolved) }];
  })));
  const runtime = await resolveRuntime();
  return {
    ok: true,
    installed: await exists(root),
    toolsRoot: root,
    ...runtime,
    nativeCapture: {
      mode: "direct-sdk",
      available: runtime.runtimeAvailable,
      description: "Uses the NDI SDK receiver to capture source frames directly before the NDI Webcam driver can crop them.",
    },
    tools,
  };
}

export async function launchNdiTool(tool: NDIToolKey = "studioMonitor") {
  const status = await getNdiToolsStatus();
  const entry = (status.tools as Record<string, { path: string; available: boolean }>)[tool];
  if (!entry?.available) {
    return { ok: false, error: `${tool} is not available.`, status };
  }
  const child = spawn(entry.path, [], {
    cwd: path.dirname(entry.path),
    detached: true,
    stdio: "ignore",
    windowsHide: false,
  });
  child.unref();
  return { ok: true, launched: tool, path: entry.path, status };
}
