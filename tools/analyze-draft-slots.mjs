import fs from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(new URL("../backend/package.json", import.meta.url));
const sharp = require("sharp");

const imagePath = process.argv[2] ?? `${process.env.TEMP}/mlbb-draft.png`;
const model = JSON.parse(fs.readFileSync(new URL("../data/cache/cv-draft-hero-model.json", import.meta.url), "utf8"));
const references = model.references;

const rails = {
  allyPicks: { rect: [0, 0.083042, 0.162621, 0.832224], count: 5, vertical: true },
  enemyPicks: { rect: [0.842233, 0.084847, 0.157767, 0.828613], count: 5, vertical: true },
  allyBans: { rect: [0.035599, 0, 0.224919, 0.086652], count: 5, vertical: false },
  enemyBans: { rect: [0.737055, 0, 0.222492, 0.088458], count: 5, vertical: false },
};

const truth = {
  allyBans: ["X.Borg", "Saber", "Gloo", "Obsidia", "Freya"],
  enemyBans: ["Harley", "Freya", "Aamon", "Angela", "Sora"],
  allyPicks: ["Lolita", "Alpha", "Ixia", "Masha", "Kagura"],
  enemyPicks: ["Florin", "Miya", "Joy", "Gord", "Silvanna"],
};

const PICK_GRID = 8;

function splitRect(rect, index, count, vertical) {
  const [x, y, width, height] = rect;
  if (vertical) return [x, y + (height * index) / count, width, height / count];
  return [x + (width * index) / count, y, width / count, height];
}

function pickSignature(rgba, width, height, gridSize = PICK_GRID) {
  const output = [];
  for (let gy = 0; gy < gridSize; gy += 1) {
    for (let gx = 0; gx < gridSize; gx += 1) {
      let red = 0;
      let green = 0;
      let blue = 0;
      let count = 0;
      const startX = Math.floor((gx / gridSize) * width);
      const endX = Math.max(startX + 1, Math.floor(((gx + 1) / gridSize) * width));
      const startY = Math.floor((gy / gridSize) * height);
      const endY = Math.max(startY + 1, Math.floor(((gy + 1) / gridSize) * height));
      for (let y = startY; y < Math.min(height, endY); y += 1) {
        for (let x = startX; x < Math.min(width, endX); x += 1) {
          const dx = (x + 0.5) / width - 0.5;
          const dy = (y + 0.5) / height - 0.5;
          if (dx * dx + dy * dy > 0.245) continue;
          if (
            (dx + 0.28) ** 2 + (dy + 0.26) ** 2 < 0.052
            || (dx - 0.28) ** 2 + (dy + 0.26) ** 2 < 0.052
            || (dx + 0.28) ** 2 + (dy - 0.26) ** 2 < 0.052
          ) continue;
          const index = (y * width + x) * 4;
          if (rgba[index + 3] < 24) continue;
          red += rgba[index];
          green += rgba[index + 1];
          blue += rgba[index + 2];
          count += 1;
        }
      }
      output.push(count ? red / count / 255 : 0, count ? green / count / 255 : 0, count ? blue / count / 255 : 0);
    }
  }
  return output;
}

function banSignature(rgba, width, height, gridSize = 16) {
  const output = [];
  for (let gy = 0; gy < gridSize; gy += 1) {
    for (let gx = 0; gx < gridSize; gx += 1) {
      let red = 0;
      let green = 0;
      let blue = 0;
      let count = 0;
      const startX = Math.floor((gx / gridSize) * width);
      const endX = Math.max(startX + 1, Math.floor(((gx + 1) / gridSize) * width));
      const startY = Math.floor((gy / gridSize) * height);
      const endY = Math.max(startY + 1, Math.floor(((gy + 1) / gridSize) * height));
      for (let y = startY; y < Math.min(height, endY); y += 1) {
        for (let x = startX; x < Math.min(width, endX); x += 1) {
          const dx = (x + 0.5) / width - 0.5;
          const dy = (y + 0.5) / height - 0.5;
          if (dx * dx + dy * dy > 0.245) continue;
          if ((dx - 0.27) ** 2 + (dy - 0.24) ** 2 < 0.045) continue;
          const index = (y * width + x) * 4;
          if (rgba[index + 3] < 24) continue;
          red += rgba[index];
          green += rgba[index + 1];
          blue += rgba[index + 2];
          count += 1;
        }
      }
      output.push(count ? red / count / 255 : 0, count ? green / count / 255 : 0, count ? blue / count / 255 : 0);
    }
  }
  return output;
}

function mirrorSignature(signature, gridSize) {
  const output = [];
  const channels = 3;
  for (let y = 0; y < gridSize; y += 1) {
    for (let x = gridSize - 1; x >= 0; x -= 1) {
      const start = (y * gridSize + x) * channels;
      output.push(...signature.slice(start, start + channels));
    }
  }
  return output;
}

function similarity(a, b) {
  if (!a.length || a.length !== b.length) return 0;
  let squaredError = 0;
  for (let i = 0; i < a.length; i += 1) squaredError += (a[i] - b[i]) ** 2;
  return Math.max(0, Math.min(1, 1 - Math.sqrt(squaredError / a.length) * 1.5));
}

function rankOriented(signature, refs, gridSize) {
  const merged = new Map();
  for (const ranked of [
    refs.map((reference) => ({ ...reference, confidence: similarity(signature, reference.signature) })),
    refs.map((reference) => ({ ...reference, confidence: similarity(mirrorSignature(signature, gridSize), reference.signature) })),
  ]) {
    for (const entry of ranked) {
      const prev = merged.get(entry.heroId);
      if (!prev || entry.confidence > prev.confidence) merged.set(entry.heroId, entry);
    }
  }
  return [...merged.values()].sort((a, b) => b.confidence - a.confidence);
}

function squareCrop(rgba, frameWidth, crop, left, top, side) {
  const x = Math.max(0, Math.min(crop.width - side, left));
  const y = Math.max(0, Math.min(crop.height - side, top));
  const data = Buffer.alloc(side * side * 4);
  for (let row = 0; row < side; row += 1) {
    const from = ((crop.top + y + row) * frameWidth + (crop.left + x)) * 4;
    data.set(rgba.subarray(from, from + side * 4), row * side * 4);
  }
  return { data, width: side, height: side };
}

function basePickCrops(rgba, frameWidth, crop, group) {
  const placements = group === "allyPicks"
    ? [[0.36, 0.04, 0.56], [0.36, 0.02, 0.58], [0.36, 0.12, 0.63], [0.35, 0.14, 0.625], [0.36, 0.1, 0.65]]
    : [[0.21, 0.12, 0.63], [0.2, 0.14, 0.625], [0.19, 0.1, 0.65]];
  return placements.map(([xRatio, yRatio, scale]) => {
    const side = Math.max(1, Math.round(crop.height * scale));
    return squareCrop(rgba, frameWidth, crop, Math.round(crop.width * xRatio), Math.round(crop.height * yRatio), side);
  });
}

function extractCrop(rgba, frameWidth, frameHeight, rect) {
  const left = Math.max(0, Math.round(rect[0] * frameWidth));
  const top = Math.max(0, Math.round(rect[1] * frameHeight));
  const width = Math.max(1, Math.round(rect[2] * frameWidth));
  const height = Math.max(1, Math.round(rect[3] * frameHeight));
  return { left, top, width, height };
}

function accept(ranking, minConf = 0.84, minMargin = 0.05) {
  const best = ranking[0];
  const second = ranking.find((entry) => entry.heroId !== best?.heroId);
  if (!best || best.confidence < minConf) return null;
  if (second && best.confidence - second.confidence < minMargin) return null;
  return best;
}

const { data, info } = await sharp(imagePath).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const results = {};

for (const [group, config] of Object.entries(rails)) {
  const isPick = group.includes("Picks");
  const refs = isPick ? references.basePickIcons : references.banIcons;
  results[group] = [];
  for (let slot = 0; slot < config.count; slot += 1) {
    const rect = splitRect(config.rect, slot, config.count, config.vertical);
    const crop = extractCrop(data, info.width, info.height, rect);
    let ranking = [];
    if (isPick) {
      const pickGroup = group;
      ranking = basePickCrops(data, info.width, crop, pickGroup)
        .flatMap((face) => rankOriented(pickSignature(face.data, face.width, face.height), refs, PICK_GRID))
        .sort((a, b) => b.confidence - a.confidence);
    } else {
      const side = Math.max(1, Math.round(Math.min(crop.width, crop.height) * 0.88));
      const ox = Math.round((crop.width - side) / 2);
      const oy = Math.round((crop.height - side) / 2);
      const square = squareCrop(data, info.width, crop, ox, oy, side);
      ranking = rankOriented(banSignature(square.data, square.width, square.height), refs, 16)
        .sort((a, b) => b.confidence - a.confidence);
    }
    const accepted = accept(ranking, isPick ? 0.84 : 0.76, isPick ? 0.05 : 0.025);
    results[group].push({
      slot: slot + 1,
      expected: truth[group][slot],
      accepted: accepted?.heroName ?? null,
      variant: accepted?.variant ?? null,
      confidence: accepted?.confidence ?? null,
      top3: ranking.slice(0, 3).map((entry) => `${entry.heroName}(${entry.variant})@${entry.confidence.toFixed(3)}`),
      ok: accepted?.heroName === truth[group][slot],
    });
  }
}

const summary = {
  imagePath,
  size: `${info.width}x${info.height}`,
  correct: Object.values(results).flat().filter((entry) => entry.ok).length,
  total: 20,
  results,
};
console.log(JSON.stringify(summary, null, 2));
