import { test, expect } from "@playwright/test";

test.describe("game overlay", () => {
  test("advisory bar renders coaching callouts", async ({ page }) => {
    await page.goto("/game-overlay");
    await expect(page.locator(".obs-overlay-page")).toBeVisible();
    await expect(page.locator(".obs-overlay-next")).toContainText("Next");
    await expect(page.locator(".obs-overlay-warning")).toContainText("Risk");
    await expect(page.locator(".obs-overlay-next strong")).not.toBeEmpty();
    await expect(page.locator(".obs-overlay-warning strong")).not.toBeEmpty();
  });
});
