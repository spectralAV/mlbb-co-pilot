import fs from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(new URL("../backend/package.json", import.meta.url));
const sharp = require("sharp");
import {
  classifyVisionFrame,
  emptyMetrics,
  regions,
  selectLayoutProfile,
} from "../frontend/src/runtime/captureRuntime.ts";

const imagePath = process.argv[2] ?? "data/capture/draft-live-test.png";
const buffer = fs.readFileSync(imagePath);
const { data, info } = await sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const width = info.width;
const height = info.height;

function sampleRect(rect) {
  const x = Math.floor(rect[0] * width);
  const y = Math.floor(rect[1] * height);
  const w = Math.max(1, Math.floor(rect[2] * width));
  const h = Math.max(1, Math.floor(rect[3] * height));
  let sum = 0;
  let sumSq = 0;
  let count = 0;
  const stride = Math.max(4, Math.floor((w * h) / 900) * 4);
  for (let row = 0; row < h; row += 1) {
    for (let col = 0; col < w; col += Math.max(1, Math.floor(stride / 4))) {
      const idx = ((y + row) * width + (x + col)) * 4;
      const luma = data[idx] * 0.299 + data[idx + 1] * 0.587 + data[idx + 2] * 0.114;
      sum += luma;
      sumSq += luma * luma;
      count += 1;
    }
  }
  const mean = count ? sum / count : 0;
  const variance = count ? Math.max(0, sumSq / count - mean * mean) : 0;
  return { mean, contrast: Math.sqrt(variance), changed: 0, active: false };
}

const metrics = emptyMetrics();
for (const region of regions) metrics[region.key] = sampleRect(region.rect);
const probes = {
  top_hud: sampleRect([0.28, 0, 0.45, 0.08]),
  draft_left_rail: sampleRect([0, 0.08, 0.22, 0.84]),
  draft_right_rail: sampleRect([0.78, 0.08, 0.22, 0.84]),
  center_panel: sampleRect([0.27, 0.1, 0.48, 0.64]),
  modal_body: sampleRect([0.1, 0.13, 0.8, 0.78]),
};
const layout = selectLayoutProfile(width, height);
const withContext = classifyVisionFrame(metrics, probes, [], true);
const withoutContext = classifyVisionFrame(metrics, probes, [], false);
const withDraftSlots = process.argv.includes("--with-draft-slots");
const draftSlotRails = {
  allyPicks: 5,
  enemyPicks: 5,
  allyBans: 5,
  enemyBans: 5,
};
const payload = {
  imagePath,
  width,
  height,
  layout,
  withDraftContext: withContext,
  withoutDraftContext: withoutContext,
  probes,
  minimap: metrics.minimap,
};
if (withDraftSlots) {
  payload.draftSlots = Object.fromEntries(
    Object.entries(draftSlotRails).map(([group, count]) => [
      group,
      Array.from({ length: count }, (_, index) => ({
        slot: index + 1,
        geometrySource: "default",
      })),
    ]),
  );
}
console.log(JSON.stringify(payload, null, 2));
