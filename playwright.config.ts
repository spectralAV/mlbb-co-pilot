import { defineConfig, devices } from "@playwright/test";

const frontendPort = Number(process.env.FRONTEND_PORT) || 5173;
const backendPort = Number(process.env.PORT) || 8787;
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? `http://127.0.0.1:${frontendPort}`;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [["github"], ["list"]] : [["list"]],
  timeout: 60_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: process.env.PLAYWRIGHT_SKIP_WEBSERVER
    ? undefined
    : [
        {
          command: "npm run dev:backend",
          url: `http://127.0.0.1:${backendPort}/api/health`,
          reuseExistingServer: !process.env.CI,
          timeout: 120_000,
          cwd: process.cwd(),
        },
        {
          command: "npm run dev:frontend",
          url: `http://127.0.0.1:${frontendPort}`,
          reuseExistingServer: !process.env.CI,
          timeout: 120_000,
          cwd: process.cwd(),
        },
      ],
});
