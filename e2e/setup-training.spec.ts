import { test, expect } from "@playwright/test";
import { mockSetupStatus } from "./helpers";

test.describe("Setup training job hint", () => {
  test.beforeEach(async ({ page }) => {
    await mockSetupStatus(page, [
      { id: "backend", label: "Backend", group: "core", state: "ready", summary: "Online", detail: "ok" },
      {
        id: "training-job",
        label: "Training Job",
        group: "vision",
        state: "action",
        summary: "Training stuck",
        detail: "Ultralytics job stuck",
        action: "Open CV Studio and stop the training job before starting capture or another train.",
      },
    ]);
  });

  test("shows training job action on setup page", async ({ page }) => {
    await page.goto("/setup");
    const trainingCheck = page.locator(".card").filter({ hasText: "Training Job" }).first();
    await expect(trainingCheck.getByText("Training Job", { exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(trainingCheck.getByText(/Training stuck/i)).toBeVisible();
  });
});
