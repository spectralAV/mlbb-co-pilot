import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";

test("getCvDatasetQuality returns class rows and analysis hints", async () => {
  const backendDir = path.resolve(import.meta.dirname, "../backend");
  const previous = process.cwd();
  process.chdir(backendDir);
  try {
    const cvRoot = path.resolve(backendDir, "../data/cv");
    const runtimeDir = path.join(cvRoot, "runtime");
    await mkdir(runtimeDir, { recursive: true });
    await writeFile(
      path.join(runtimeDir, "dataset-analysis.json"),
      `${JSON.stringify({
        generatedAt: new Date().toISOString(),
        splits: {
          train: { draftMeanSlotIoU: 0.91, aspectBuckets: { "20:9": 120 } },
        },
        recommendations: ["ok"],
      })}\n`,
      "utf8",
    );

    const { getCvDatasetQuality } = await import("../backend/src/services/cvDatasetQuality.ts");
    const report = await getCvDatasetQuality();
    assert.ok(Array.isArray(report.classRows));
    assert.equal(report.classRows.length > 0, true);
    assert.equal(report.draftMeanSlotIoU, 0.91);
    assert.equal(report.phone20x9Frames, 120);
    assert.ok(Array.isArray(report.recommendations));
    assert.equal(report.classRows[0]?.name, "minimap_panel");
    assert.equal(typeof report.draftMeanSlotIoU === "number" || report.draftMeanSlotIoU === null, true);
  } finally {
    process.chdir(previous);
  }
});
