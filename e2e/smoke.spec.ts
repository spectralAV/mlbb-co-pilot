import { test, expect } from "@playwright/test";
import { enableAdvancedSurfaces } from "./helpers";

test.describe("app smoke", () => {
  test.beforeEach(async ({ page }) => {
    await enableAdvancedSurfaces(page);
  });

  test("dashboard shows backend online", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Operations" })).toBeVisible();
    await expect(page.getByText("Online", { exact: true }).first()).toBeVisible();
  });

  test("setup and draft routes render", async ({ page }) => {
    await page.goto("/setup");
    await expect(page.getByRole("link", { name: "First Run" })).toBeVisible();

    await page.goto("/draft");
    await expect(page.getByRole("link", { name: "Draft Assistant" })).toBeVisible();
  });

  test("backend health API responds", async ({ request }) => {
    const backendPort = Number(process.env.PORT) || 8787;
    const response = await request.get(`http://127.0.0.1:${backendPort}/api/health`);
    expect(response.ok()).toBeTruthy();
    const body = await response.json();
    expect(body.ok).toBe(true);
    expect(body.service).toBe("MLBB Co-Pilot");
  });
});
