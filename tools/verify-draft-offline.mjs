/**
 * Offline draft CV verification: YOLO slot geometry + optional hero matcher on cached ADB frame.
 *
 * Usage:
 *   node tools/verify-draft-offline.mjs [path/to/frame.png]
 */
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const geometryOnly = args.includes("--geometry-only");
const frameArg = args.find((arg) => !arg.startsWith("--"));
const framePath = frameArg ?? path.join(root, "data", "cache", "last-adb-frame.png");
const fallbackJpg = path.join(root, "data", "cache", "last-adb-frame.jpg");
const resolved = fs.existsSync(framePath) ? framePath : fallbackJpg;

const DRAFT_SLOT_CLASSES = new Set([
  "draft_screen",
  "ally_pick_slot",
  "enemy_pick_slot",
  "ally_ban_slot",
  "enemy_ban_slot",
  "lane_marker",
  "battle_spell_marker",
]);

const GROUND_TRUTH = {
  allyBans: ["X.Borg", "Saber", "Gloo", "Obsidia", "Freya"],
  enemyBans: ["Harley", "Freya", "Aamon", "Angela", "Sora"],
  allyPicks: ["Lolita", "Alpha", "Ixia", "Masha", "Kagura"],
  enemyPicks: ["Florin", "Miya", "Joy", "Gord", "Silvanna"],
};

function pythonPath() {
  const venv = path.join(root, "data", "cv", ".venv", "Scripts", "python.exe");
  return fs.existsSync(venv) ? venv : "python";
}

function runYoloInfer(imagePath) {
  const script = path.join(root, "backend", "tools", "ultralyticsVision.py");
  const proc = spawnSync(
    pythonPath(),
    [script, "infer", "--project-root", root, "--image", imagePath, "--confidence", "0.45", "--image-size", "960"],
    { cwd: root, encoding: "utf8", maxBuffer: 20 * 1024 * 1024 },
  );
  if (proc.stderr) process.stderr.write(proc.stderr);
  if (proc.status !== 0) {
    console.error("YOLO infer failed.");
    return null;
  }
  try {
    const lastLine = proc.stdout.trim().split(/\r?\n/).filter(Boolean).pop() ?? "{}";
    const payload = JSON.parse(lastLine);
    return payload.ok ? payload.data : null;
  } catch {
    console.error("Could not parse YOLO infer output.");
    return null;
  }
}

function summarizeYolo(data) {
  const detections = Array.isArray(data?.detections) ? data.detections : [];
  const draftSlots = detections.filter((d) => DRAFT_SLOT_CLASSES.has(d.className));
  const byClass = Object.fromEntries(
    [...DRAFT_SLOT_CLASSES].map((name) => [name, draftSlots.filter((d) => d.className === name).length]),
  );
  return {
    total: detections.length,
    draftRelated: draftSlots.length,
    byClass,
    topDraft: draftSlots
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, 12)
      .map((d) => `${d.className}@${d.confidence}`),
    geometryReady: draftSlots.some((d) => d.className.includes("_slot") && d.confidence >= 0.45),
  };
}

if (geometryOnly) {
  console.log("Geometry-only draft verify (CI mode): running draft unit tests...");
  const proc = spawnSync(
    "npx",
    ["tsx", "--test", "../tests/draftLifecycle.test.ts", "../tests/draftStabilizer.test.ts", "../tests/draftYoloSlots.test.ts"],
    { cwd: path.join(root, "backend"), encoding: "utf8", shell: true },
  );
  if (proc.stdout) process.stdout.write(proc.stdout);
  if (proc.stderr) process.stderr.write(proc.stderr);
  process.exit(proc.status === 0 ? 0 : 1);
}

if (!fs.existsSync(resolved)) {
  console.error(`Missing frame: ${framePath} (and ${fallbackJpg})`);
  console.error("Run Live Capture on ADB/scrcpy while on the draft screen first.");
  process.exit(1);
}

const weights = path.join(root, "data", "cv", "models", "mlbb-detect.pt");
if (!fs.existsSync(weights)) {
  console.error(`Missing weights: ${weights}`);
  console.error("Run: npm run cv:wsl:train");
  process.exit(1);
}

console.log(`Frame: ${resolved}`);
console.log(`Weights: ${weights}`);

console.log("\n--- YOLO draft geometry (mlbb-detect) ---\n");
const yolo = runYoloInfer(resolved);
if (yolo) {
  const summary = summarizeYolo(yolo);
  console.log(JSON.stringify(summary, null, 2));
  if (!summary.geometryReady) {
    console.warn("No draft slot boxes >= 0.45 — live CV will fall back to default/calibrated rails.");
  }
} else {
  console.warn("Skipped YOLO infer.");
}

const analyzeSlots = path.join(root, "tools", "analyze-draft-slots.mjs");
const heroModel = path.join(root, "data", "cache", "cv-draft-hero-model.json");
if (fs.existsSync(analyzeSlots) && fs.existsSync(heroModel)) {
  console.log("\n--- hero matcher (ADB icon/banner banks) ---\n");
  const slots = spawnSync(process.execPath, [analyzeSlots, resolved], { cwd: root, encoding: "utf8" });
  if (slots.stdout) process.stdout.write(slots.stdout);
  if (slots.stderr) process.stderr.write(slots.stderr);
} else {
  console.log("\n--- hero matcher skipped ---");
  console.log("Index Draft Assets in Settings, then re-run. Needs data/cache/cv-draft-hero-model.json from sync.");
}

const analyzeFrame = path.join(root, "tools", "analyze-capture-frame.mjs");
if (fs.existsSync(analyzeFrame)) {
  console.log("\n--- screen heuristics (optional) ---\n");
  const frame = spawnSync(process.execPath, [analyzeFrame, resolved], { cwd: root, encoding: "utf8" });
  if (frame.status === 0 && frame.stdout) process.stdout.write(frame.stdout);
  else console.log("(skipped — run from Live Capture UI for full heuristics)");
}

const exitCode = yolo?.detections && summarizeYolo(yolo).geometryReady ? 0 : 1;
process.exitCode = exitCode;

console.log("\nGround truth (reference ranked draft):");
for (const [group, names] of Object.entries(GROUND_TRUTH)) {
  console.log(`  ${group}: ${names.join(", ")}`);
}
console.log("\nLive device pass: Backend scrcpy + Draft Room; see docs/cv-draft-verify.md");
