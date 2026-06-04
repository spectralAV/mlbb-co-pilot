import type { Page, Route } from "@playwright/test";

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

/** Match API calls whether the app uses relative URLs (dev proxy) or absolute apiBase. */
export async function routeApiJson(
  page: Page,
  pathSuffix: string,
  body: unknown,
  status = 200,
) {
  const normalized = pathSuffix.startsWith("/") ? pathSuffix : `/${pathSuffix}`;
  const pattern = `**${normalized}`;
  await page.route(pattern, async (route: Route) => {
    await route.fulfill({
      status,
      contentType: "application/json",
      body: JSON.stringify(body),
    });
  });
}

export async function mockCvStudioApis(page: Page) {
  await routeApiJson(page, "/api/vision/models/ultralytics/training/status", {
    success: true,
    data: { id: "", state: "idle", elapsedMs: 0, pid: null, trainingScope: "full" },
  });
  await routeApiJson(page, "/api/cv/dataset/quality", {
    success: true,
    data: {
      draftMeanSlotIoU: 0.91,
      classRows: [{ id: 0, name: "minimap_panel", train: 12, val: 4 }],
      hints: ["Dataset quality mock"],
      gaps: { missingValClasses: [], zeroTrainClasses: [] },
    },
  });
  await routeApiJson(page, "/api/vision/annotations/classes", {
    success: true,
    data: [{ id: 0, name: "draft_screen", group: "draft" }],
  });
  await routeApiJson(page, "/api/vision/annotations", {
    success: true,
    data: [],
  });
  await routeApiJson(page, "/api/vision/models/ultralytics/status", {
    success: true,
    data: { packageAvailable: true, modelAvailable: true, training: { images: 0 } },
  });
}

export async function mockCvEditorApis(page: Page) {
  await mockCvStudioApis(page);
  await routeApiJson(page, "/api/vision/heroes/manifest", {
    success: true,
    data: { heroes: [{ id: 1, name: "Miya" }] },
  });
}

export async function mockCvOcrApis(page: Page) {
  await routeApiJson(page, "/api/vision/models/screen-ocr/status", {
    success: true,
    data: { packageAvailable: false, paddleAvailable: false, enabledForLiveCapture: false },
  });
  await routeApiJson(page, "/api/obs/regions", {
    success: true,
    data: { regions: [] },
  });
}

export async function mockSetupStatus(page: Page, checks: unknown[]) {
  await routeApiJson(page, "/api/setup/status", {
    ok: true,
    version: "0.5.0-desktop-alpha",
    readiness: {
      launchReady: false,
      requiredReady: 1,
      requiredTotal: 2,
      optionalReady: 0,
      optionalTotal: 0,
      summary: "1 required setup item needs attention.",
    },
    checks,
  });
}

export async function mockDraftSimulatorApis(page: Page) {
  await routeApiJson(page, "/api/draft/simulator/scenarios", {
    success: true,
    data: [{ id: "missed_ally_ban_slot", description: "Skipped ban slot", frameCount: 3, expect: {} }],
  });
  await routeApiJson(page, "/api/draft/simulator/assets-status", {
    success: true,
    data: { manifest: { extraction: { textures: 120 }, library: { uiDownloaded: 5 }, inventory: { uiBundles: 10 } } },
  });
  await routeApiJson(page, "/api/draft/simulator/reference-frames", {
    success: true,
    data: [{ id: "last-adb", label: "Last ADB", available: false, bytes: 0 }],
  });
  await routeApiJson(page, "/api/draft/simulator/replay", {
    success: true,
    data: {
      scenarioId: "missed_ally_ban_slot",
      steps: [],
      passed: true,
      failures: [],
      latest: { state: { allyBans: [], allyPicks: [] } },
    },
  });
}
