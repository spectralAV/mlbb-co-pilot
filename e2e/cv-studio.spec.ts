import { test, expect } from "@playwright/test";
import { enableAdvancedSurfaces } from "./helpers";

test.describe("CV Studio", () => {
  test.beforeEach(async ({ page }) => {
    await enableAdvancedSurfaces(page);
  });

  test("dataset training panel is visible", async ({ page }) => {
    await page.goto("/cv-studio");
    await expect(page.getByRole("heading", { name: "CV Studio" })).toBeVisible();
    await expect(page.getByRole("button", { name: /Quick Fine-Tune/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /Full Train/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /Export ONNX/i })).toBeVisible();
    await expect(page.getByText("Dataset editor is ready.")).toBeVisible();
  });

  test("studio sub-routes load", async ({ page }) => {
    await page.goto("/cv-studio/editor");
    await expect(page.getByRole("link", { name: /Model Editor/i })).toBeVisible();

    await page.goto("/cv-studio/ocr");
    await expect(page.getByRole("link", { name: /HUD OCR/i })).toBeVisible();
  });
});
