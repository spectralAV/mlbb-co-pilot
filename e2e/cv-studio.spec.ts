import { test, expect } from "@playwright/test";
import { enableAdvancedSurfaces, mockCvEditorApis, mockCvOcrApis, mockCvStudioApis } from "./helpers";

test.describe("CV Studio", () => {
  test.beforeEach(async ({ page }) => {
    await enableAdvancedSurfaces(page);
    await mockCvStudioApis(page);
  });

  test("dataset training panel is visible", async ({ page }) => {
    await page.goto("/cv-studio");
    await expect(page.getByRole("heading", { name: "CV Studio" })).toBeVisible();
    await expect(page.getByRole("button", { name: /Quick Fine-Tune/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /Full Train/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /Export ONNX/i })).toBeVisible();
    await expect(page.getByText("Dataset editor is ready.")).toBeVisible();
  });

  test("dataset quality metrics render when API returns class rows", async ({ page }) => {
    await page.goto("/cv-studio");
    await expect(page.getByText("Draft slot IoU")).toBeVisible();
    await expect(page.getByText("0.910")).toBeVisible();
  });

  test("studio sub-routes load", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));

    await mockCvEditorApis(page);
    await page.goto("/cv-studio/editor");
    await expect(page.getByRole("heading", { name: "Model Editor" })).toBeVisible({ timeout: 30_000 });
    expect(errors, errors.join("\n")).toEqual([]);

    await mockCvOcrApis(page);
    await page.goto("/cv-studio/ocr");
    await expect(page.getByRole("heading", { name: /HUD OCR Editor/i })).toBeVisible({ timeout: 30_000 });
  });
});
