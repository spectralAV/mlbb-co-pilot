const { app, BrowserWindow, shell } = require("electron");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const DEFAULT_PORT = 8787;
const BACKEND_HOST = "127.0.0.1";

let mainWindow = null;
let backendProcess = null;

function backendPort() {
  const parsed = Number(process.env.PORT);
  return Number.isFinite(parsed) ? parsed : DEFAULT_PORT;
}

function backendOrigin() {
  return process.env.MLBB_ELECTRON_BACKEND_ORIGIN ?? `http://${BACKEND_HOST}:${backendPort()}`;
}

function resourceRoot() {
  return app.isPackaged ? process.resourcesPath : app.getAppPath();
}

function backendDir() {
  return path.join(resourceRoot(), "backend");
}

function backendEntry() {
  return path.join(backendDir(), "dist", "server.js");
}

function frontendUrl() {
  return process.env.MLBB_ELECTRON_FRONTEND_URL ?? backendOrigin();
}

function shouldManageBackend() {
  return process.env.MLBB_ELECTRON_MANAGED_BACKEND !== "0";
}

async function waitForHealth(origin, timeoutMs = 20000) {
  const startedAt = Date.now();
  let lastError = null;

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(`${origin}/api/health`, { cache: "no-store" });
      if (response.ok) return true;
      lastError = new Error(`Health check returned ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 350));
  }

  throw lastError ?? new Error("Backend health check timed out.");
}

function startBackend() {
  if (!shouldManageBackend()) return;

  const entry = backendEntry();
  if (!fs.existsSync(entry)) {
    throw new Error(`Backend build not found at ${entry}. Run npm run build first.`);
  }

  backendProcess = spawn(process.execPath, [entry], {
    cwd: backendDir(),
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
      HOST: BACKEND_HOST,
      PORT: String(backendPort()),
      MLBB_ELECTRON: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });

  backendProcess.stdout.on("data", (data) => {
    console.log(`[backend] ${String(data).trim()}`);
  });
  backendProcess.stderr.on("data", (data) => {
    console.error(`[backend] ${String(data).trim()}`);
  });
  backendProcess.on("exit", (code, signal) => {
    if (!app.isQuitting) {
      console.error(`Backend exited with code ${code ?? "null"} and signal ${signal ?? "null"}.`);
    }
    backendProcess = null;
  });
}

async function createWindow() {
  const origin = backendOrigin();
  if (shouldManageBackend()) {
    startBackend();
    await waitForHealth(origin);
  }

  mainWindow = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 1100,
    minHeight: 720,
    title: "MLBB Co-Pilot",
    backgroundColor: "#07111f",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      preload: path.join(__dirname, "preload.cjs"),
      additionalArguments: [`--mlbb-backend-origin=${origin}`],
    },
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });

  await mainWindow.loadURL(frontendUrl());
}

function stopBackend() {
  if (!backendProcess) return;
  backendProcess.kill();
  backendProcess = null;
}

app.on("before-quit", () => {
  app.isQuitting = true;
  stopBackend();
});

app.whenReady().then(() => {
  void createWindow().catch((error) => {
    console.error(error);
    app.quit();
  });
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) void createWindow();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
