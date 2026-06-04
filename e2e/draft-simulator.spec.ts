import { test, expect } from "@playwright/test";
import { enableAdvancedSurfaces, mockDraftSimulatorApis } from "./helpers";

test.describe("Draft Simulator", () => {
  test.beforeEach(async ({ page }) => {
    await enableAdvancedSurfaces(page);
    await mockDraftSimulatorApis(page);
  });

  test("lists scenarios and replays with pass badge", async ({ page }) => {
    await page.goto("/draft-simulator");
    await expect(page.getByRole("heading", { name: /Draft Simulator/i })).toBeVisible();
    const scenarioCard = page.getByRole("button", { name: /missed_ally_ban_slot/i });
    await expect(scenarioCard).toBeVisible();
    await scenarioCard.click();
    await page.getByRole("button", { name: /Replay scenario/i }).click();
    await expect(page.getByText("Scenario passed")).toBeVisible();
  });
});
