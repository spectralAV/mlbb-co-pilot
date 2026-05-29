import { getEquipmentRecognitionManifest } from "../api/client";
import { acceptIconMatch, rankIconCandidates, spellIconSignatureFromRgba, type HeroIconReference } from "./iconMatcher";
import { calibratedRect } from "./calibrationRegions";

type NormalizedRect = [number, number, number, number];
export type DetectedEquipmentItem = {
  itemId: number;
  itemName: string;
  side: "ally" | "enemy";
  row: number;
  slot: number;
  confidence: number;
  source: "equipment-item-icon";
};

const allyColumnCenters = [0.308, 0.341, 0.374, 0.407, 0.44, 0.473];
const enemyColumnCenters = [0.525, 0.558, 0.592, 0.625, 0.658, 0.692];
const rowCenters = [0.354, 0.48, 0.605, 0.73, 0.856];
const itemWidth = 0.028;
const itemHeight = 0.0625;
const defaultEquipmentWindow: NormalizedRect = [0.1, 0.13, 0.8, 0.78];
let referencesPromise: Promise<HeroIconReference[]> | null = null;

export function configuredEquipmentSlots(side: "ally" | "enemy") {
  const columns = side === "ally" ? allyColumnCenters : enemyColumnCenters;
  return rowCenters.flatMap((centerY, row) => columns.map((centerX, slot) => ({
    side,
    row: row + 1,
    slot: slot + 1,
    rect: projectThroughEquipmentWindow(centeredRect(centerX, centerY)),
  })));
}

export async function detectEquipmentItems(canvas: HTMLCanvasElement, diagnostics = false) {
  const crops = [...configuredEquipmentSlots("ally"), ...configuredEquipmentSlots("enemy")].map((slot) => ({
    ...slot,
    image: cropForRect(canvas, slot.rect),
  }));
  const references = await getReferences();
  const detected: DetectedEquipmentItem[] = [];
  const debug: unknown[] = [];

  for (const crop of crops) {
    if (!crop.image || !hasVisibleEquipmentIcon(crop.image.data)) continue;
    const ranking = rankIconCandidates(
      spellIconSignatureFromRgba(crop.image.data, crop.image.width, crop.image.height, 8),
      references,
    );
    const accepted = acceptIconMatch(ranking, 0.78, 0.045);
    debug.push({
      row: crop.row,
      slot: crop.slot,
      ranking: ranking.slice(0, 2).map((entry) => ({ name: entry.heroName, confidence: entry.confidence })),
      accepted: accepted?.heroName ?? null,
    });
    if (!accepted) continue;
    detected.push({
      itemId: accepted.heroId,
      itemName: accepted.heroName,
      side: crop.side,
      row: crop.row,
      slot: crop.slot,
      confidence: accepted.confidence,
      source: "equipment-item-icon",
    });
  }

  if (diagnostics) console.info("[equipment-cv-diagnostics]", JSON.stringify(debug));
  return detected;
}

export function hasVisibleEquipmentIcon(rgba: Uint8ClampedArray) {
  let colored = 0;
  let sampled = 0;
  for (let index = 0; index < rgba.length; index += 16) {
    const red = rgba[index];
    const green = rgba[index + 1];
    const blue = rgba[index + 2];
    const luma = red * 0.299 + green * 0.587 + blue * 0.114;
    const spread = Math.max(red, green, blue) - Math.min(red, green, blue);
    if (luma > 34 && spread > 20) colored += 1;
    sampled += 1;
  }
  return sampled > 0 && colored / sampled > 0.09;
}

async function getReferences() {
  if (!referencesPromise) referencesPromise = loadReferences();
  return referencesPromise;
}

async function loadReferences() {
  const response = await getEquipmentRecognitionManifest();
  const references: HeroIconReference[] = [];
  for (const item of response?.data?.items ?? []) {
    const image = await loadImage(`/api/vision/equipment/icon/${item.id}`);
    if (!image) continue;
    const canvas = document.createElement("canvas");
    canvas.width = 64;
    canvas.height = 64;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) continue;
    context.fillStyle = "#172536";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    references.push({
      heroId: Number(item.id),
      heroName: String(item.name),
      variant: "normal",
      signature: spellIconSignatureFromRgba(context.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height, 8),
    });
  }
  return references;
}

function centeredRect(x: number, y: number): NormalizedRect {
  return [x - itemWidth / 2, y - itemHeight / 2, itemWidth, itemHeight];
}

function projectThroughEquipmentWindow(rect: NormalizedRect): NormalizedRect {
  const target = calibratedRect("equipment_window_norm", defaultEquipmentWindow);
  const scaleX = target[2] / defaultEquipmentWindow[2];
  const scaleY = target[3] / defaultEquipmentWindow[3];
  return [
    target[0] + (rect[0] - defaultEquipmentWindow[0]) * scaleX,
    target[1] + (rect[1] - defaultEquipmentWindow[1]) * scaleY,
    rect[2] * scaleX,
    rect[3] * scaleY,
  ];
}

function cropForRect(canvas: HTMLCanvasElement, rect: NormalizedRect) {
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return null;
  return context.getImageData(
    Math.round(rect[0] * canvas.width),
    Math.round(rect[1] * canvas.height),
    Math.max(1, Math.round(rect[2] * canvas.width)),
    Math.max(1, Math.round(rect[3] * canvas.height)),
  );
}

function loadImage(url: string) {
  return new Promise<HTMLImageElement | null>((resolve) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = url;
  });
}
