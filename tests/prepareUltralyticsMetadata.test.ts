import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { test } from "node:test";

const projectRoot = path.resolve(process.cwd(), "..");
const pythonScript = path.join(projectRoot, "backend", "tools", "prepareUltralyticsDataset.py");

function pythonExecutable() {
  const venv = path.join(projectRoot, "data", "cv", ".venv", "Scripts", "python.exe");
  return existsSync(venv) ? venv : "python";
}

test("build_phone_cache_annotation_metadata matches CV Lab schema", () => {
  const snippet = `
from prepareUltralyticsDataset import build_phone_cache_annotation_metadata, yolo_lines_to_boxes, draft_labels
labels = draft_labels("mythic", 1280, 2856)
meta = build_phone_cache_annotation_metadata(
    "phone-cache-test-00",
    "phone-cache-test-00.png",
    "train",
    "data/cache/sample.png",
    1280,
    2856,
    labels,
    "note",
)
import json
print(json.dumps(meta))
`;
  const proc = spawnSync(pythonExecutable(), ["-c", snippet], {
    cwd: path.join(projectRoot, "backend", "tools"),
    encoding: "utf8",
    env: { ...process.env, PYTHONPATH: path.join(projectRoot, "backend", "tools") },
  });
  if (proc.status !== 0) {
    console.error(proc.stderr || proc.stdout);
  }
  assert.equal(proc.status, 0);
  const meta = JSON.parse(proc.stdout.trim().split(/\r?\n/).pop() ?? "{}") as Record<string, unknown>;
  assert.equal(meta.split, "train");
  assert.equal(typeof meta.createdAt, "string");
  assert.ok(Array.isArray(meta.boxes));
  assert.equal(typeof meta.width, "number");
  assert.equal(typeof meta.height, "number");
  assert.equal(typeof meta.imageName, "string");
});
