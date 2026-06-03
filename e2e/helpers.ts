import type { Page } from "@playwright/test";

const advancedSurfacesStorageKey = "mlbb.ui.showAdvancedSurfaces";

/** CV Studio and Operations live behind the advanced-surfaces preference. */
export async function enableAdvancedSurfaces(page: Page) {
  await page.addInitScript((key) => {
    window.localStorage.setItem(key, "1");
  }, advancedSurfacesStorageKey);
}

export async function waitForBackendHealth(page: Page, backendPort = Number(process.env.PORT) || 8787) {
  const health = page.request.get(`http://127.0.0.1:${backendPort}/api/health`);
  await health.then((response) => response.ok());
}
