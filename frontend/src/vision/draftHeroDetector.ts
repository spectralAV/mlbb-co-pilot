import { getHeroRecognitionManifest, ingestDraftRecognition } from "../api/client";
import type { LiveVisionFrame, SourceMode } from "../runtime/captureRuntime";
import {
  acceptPortraitMatch,
  mirrorPortraitSignature,
  portraitSignatureFromRgba,
  rankPortraitCandidates,
  type PortraitReference,
} from "./portraitMatcher";

type NormalizedRect = [number, number, number, number];
type SlotGroup = "allyPicks" | "enemyPicks" | "allyBans" | "enemyBans";
type SlotDetection = {
  heroId: number;
  heroName: string;
  confidence: number;
  variant: "normal" | "mirror-x";
  source: "draft-slot";
};

const rails: Record<SlotGroup, { rect: NormalizedRect; count: number; vertical: boolean }> = {
  allyBans: { rect: [0.035599, 0, 0.224919, 0.086652], count: 5, vertical: false },
  enemyBans: { rect: [0.737055, 0, 0.222492, 0.088458], count: 5, vertical: false },
  allyPicks: { rect: [0, 0.083042, 0.162621, 0.832224], count: 5, vertical: true },
  enemyPicks: { rect: [0.842233, 0.084847, 0.157767, 0.828613], count: 5, vertical: true },
};

let referencesPromise: Promise<PortraitReference[]> | null = null;
let recognitionInFlight = false;
let lastAttemptAt = 0;
let lastPostedAt = 0;
let lastFingerprint = "";

export function configuredDraftPortraitSlots() {
  return Object.fromEntries(
    Object.entries(rails).map(([key, group]) => [
      key,
      Array.from({ length: group.count }, (_, index) => splitRect(group.rect, index, group.count, group.vertical)),
    ]),
  ) as Record<SlotGroup, NormalizedRect[]>;
}

export function queueDraftHeroRecognition(
  canvas: HTMLCanvasElement,
  vision: LiveVisionFrame,
  source: SourceMode,
) {
  if (vision.screen !== "draft" || vision.confidence < 0.55 || recognitionInFlight) return;
  const now = performance.now();
  if (now - lastAttemptAt < 900) return;
  lastAttemptAt = now;
  recognitionInFlight = true;
  void detectDraftHeroes(canvas, source)
    .catch(() => {})
    .finally(() => {
      recognitionInFlight = false;
    });
}

async function detectDraftHeroes(canvas: HTMLCanvasElement, source: SourceMode) {
  const references = await getReferences();
  if (!references.length) return;
  const slots = configuredDraftPortraitSlots();
  const recognition: Record<SlotGroup, SlotDetection[]> = {
    allyPicks: [],
    enemyPicks: [],
    allyBans: [],
    enemyBans: [],
  };

  for (const group of Object.keys(slots) as SlotGroup[]) {
    for (const rect of slots[group]) {
      const signature = signatureForRect(canvas, rect);
      const accepted = acceptPortraitMatch(rankPortraitCandidates(signature, references));
      if (accepted) recognition[group].push({ ...accepted, source: "draft-slot" });
    }
  }

  const facts = Object.values(recognition).flat();
  if (!facts.length) return;
  const fingerprint = JSON.stringify(
    Object.fromEntries(Object.entries(recognition).map(([key, entries]) => [key, entries.map((entry) => entry.heroId)])),
  );
  const now = Date.now();
  if (fingerprint === lastFingerprint && now - lastPostedAt < 4000) return;
  lastFingerprint = fingerprint;
  lastPostedAt = now;
  await ingestDraftRecognition({
    phase: "pick",
    ...recognition,
    frameId: `${source}:${now}`,
    timestamp: now,
  });
}

function splitRect(rect: NormalizedRect, index: number, count: number, vertical: boolean): NormalizedRect {
  const [x, y, width, height] = rect;
  if (vertical) return [x, y + (height * index) / count, width, height / count];
  return [x + (width * index) / count, y, width / count, height];
}

function signatureForRect(canvas: HTMLCanvasElement, rect: NormalizedRect) {
  const [x, y, width, height] = rect;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return [];
  const crop = context.getImageData(
    Math.max(0, Math.round(x * canvas.width)),
    Math.max(0, Math.round(y * canvas.height)),
    Math.max(1, Math.round(width * canvas.width)),
    Math.max(1, Math.round(height * canvas.height)),
  );
  return portraitSignatureFromRgba(crop.data, crop.width, crop.height);
}

async function getReferences() {
  if (!referencesPromise) referencesPromise = loadReferences();
  return referencesPromise;
}

async function loadReferences() {
  const response = await getHeroRecognitionManifest();
  const heroes = Array.isArray(response?.data?.heroes) ? response.data.heroes : [];
  const references: PortraitReference[] = [];
  for (let index = 0; index < heroes.length; index += 12) {
    const batch = heroes.slice(index, index + 12);
    const loaded = await Promise.all(batch.map(async (hero: any) => {
      const image = await loadImage(`/api/vision/heroes/icon/${hero.id}`);
      if (!image) return [];
      const canvas = document.createElement("canvas");
      canvas.width = 64;
      canvas.height = 64;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) return [];
      context.drawImage(image, 0, 0, 64, 64);
      const normal = portraitSignatureFromRgba(context.getImageData(0, 0, 64, 64).data, 64, 64);
      return [
        { heroId: Number(hero.id), heroName: String(hero.name), variant: "normal" as const, signature: normal },
        { heroId: Number(hero.id), heroName: String(hero.name), variant: "mirror-x" as const, signature: mirrorPortraitSignature(normal) },
      ];
    }));
    references.push(...loaded.flat());
  }
  return references;
}

function loadImage(url: string) {
  return new Promise<HTMLImageElement | null>((resolve) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = url;
  });
}
