const { spawn } = require("node:child_process");
const electron = require("electron");

const frontendUrl = process.env.MLBB_ELECTRON_FRONTEND_URL ?? "http://127.0.0.1:5173";
const backendOrigin = process.env.MLBB_ELECTRON_BACKEND_ORIGIN ?? "http://127.0.0.1:8787";

async function waitFor(url, label, timeoutMs = 30000) {
  const startedAt = Date.now();
  let lastError = null;
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url, { cache: "no-store" });
      if (response.ok) return;
      lastError = new Error(`${label} returned ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 350));
  }
  throw lastError ?? new Error(`${label} did not start.`);
}

async function main() {
  await Promise.all([
    waitFor(frontendUrl, "Frontend"),
    waitFor(`${backendOrigin}/api/health`, "Backend"),
  ]);

  const child = spawn(electron, ["."], {
    env: {
      ...process.env,
      MLBB_ELECTRON_FRONTEND_URL: frontendUrl,
      MLBB_ELECTRON_BACKEND_ORIGIN: backendOrigin,
      MLBB_ELECTRON_MANAGED_BACKEND: "0",
    },
    stdio: "inherit",
    windowsHide: true,
  });

  child.on("exit", (code) => process.exit(code ?? 0));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
