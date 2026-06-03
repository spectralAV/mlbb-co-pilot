import { getDraftHeroModel, getHeroRecognitionManifest, getSkinSignatureManifest, ingestDraftRecognition } from "../api/client";
import type { LiveVisionFrame, SourceMode } from "../runtime/captureRuntime";
import {
  acceptIconMatch,
  mirrorIconSignature,
  iconSignatureFromRgba,
  pickIconSignatureFromRgba,
  rankIconCandidates,
  type HeroIconReference,
} from "./iconMatcher";
import { detectDraftVisualContext } from "./draftContextDetector";
import { detectDraftAuxiliaryFacts } from "./draftAuxDetector";
import { calibratedRectForKeys } from "./calibrationRegions";
import {
  acceptPortraitMatch,
  draftBannerSignatureFromRgba,
  mirrorDraftBannerSignature,
  rankDraftBannerCandidates,
  type HeroPortraitReference,
} from "./portraitMatcher";

type NormalizedRect = [number, number, number, number];
type SlotGroup = "allyPicks" | "enemyPicks" | "allyBans" | "enemyBans";
type SlotDetection = {
  heroId: number;
  heroName: string;
  slot: number;
  confidence: number;
  variant: "normal" | "mirror-x";
  source: "draft-ban-icon" | "draft-pick-portrait";
};
type AcceptedHeroMatch = Omit<SlotDetection, "slot" | "source">;
type SlotDiagnostic = {
  group: SlotGroup;
  slot: number;
  visible: boolean;
  candidates: Array<{ heroName: string; confidence: number }>;
  model?: "ban-icon" | "base-icon" | "base-icon-overlay" | "calibrated-interior" | "base-portrait-banner" | "skin-icon";
  thumbnailCandidates?: Array<{ heroName: string; confidence: number }>;
  bannerCandidates?: Array<{ heroName: string; confidence: number }>;
  accepted: string | null;
};

const PICK_ICON_GRID_SIZE = 8;
const BASE_PICK_MIN_CONFIDENCE = 0.84;
const BASE_PICK_MIN_MARGIN = 0.05;
const OVERLAY_PICK_MIN_CONFIDENCE = 0.85;
const OVERLAY_PICK_MIN_MARGIN = 0.06;
const BANNER_PICK_MIN_CONFIDENCE = 0.825;
const BANNER_PICK_MIN_MARGIN = 0.018;
const CALIBRATED_INTERIOR_MIN_CONFIDENCE = 0.95;
const BANNER_COLUMNS = 30;
const BANNER_ROWS = 20;
const FINAL_PICK_MIN_CONFIDENCE = 0.85;
const FINAL_PICK_MIN_MARGIN = 0.045;
const defaultRails: Record<SlotGroup, { rect: NormalizedRect; count: number; vertical: boolean; asset: "icon" | "portrait" }> = {
  allyPicks: { rect: [0, 0.112, 0.162621, 0.812], count: 5, vertical: true, asset: "portrait" },
  enemyPicks: { rect: [0.842233, 0.112, 0.157767, 0.812], count: 5, vertical: true, asset: "portrait" },
  allyBans: { rect: [0.035599, 0, 0.224919, 0.086652], count: 5, vertical: false, asset: "icon" },
  enemyBans: { rect: [0.737055, 0, 0.222492, 0.088458], count: 5, vertical: false, asset: "icon" },
};

function configuredRails() {
  return {
    allyPicks: { ...defaultRails.allyPicks, rect: calibratedRectForKeys(["ally_picks_norm", "ally_pick_portraits_norm"], defaultRails.allyPicks.rect) },
    enemyPicks: { ...defaultRails.enemyPicks, rect: calibratedRectForKeys(["enemy_picks_norm", "enemy_pick_portraits_norm"], defaultRails.enemyPicks.rect) },
    allyBans: { ...defaultRails.allyBans, rect: calibratedRectForKeys(["ally_bans_norm"], defaultRails.allyBans.rect) },
    enemyBans: { ...defaultRails.enemyBans, rect: calibratedRectForKeys(["enemy_bans_norm"], defaultRails.enemyBans.rect) },
  };
}
const calibratedEnemyBannerTemplates = [
  { heroId: 46, heroName: "Odette", variant: "mirror-x" as const, url: "/assets/fixtures/draft/templates/enemy-pick-odette.jpg" },
  { heroId: 60, heroName: "Hanabi", variant: "mirror-x" as const, url: "/assets/fixtures/draft/templates/enemy-pick-hanabi.jpg" },
  { heroId: 90, heroName: "Silvanna", variant: "mirror-x" as const, url: "/assets/fixtures/draft/templates/enemy-pick-silvanna.jpg" },
];
const calibratedEnemyFrameSamples = [
  { heroId: 7, heroName: "Alucard", variant: "mirror-x" as const, url: "/assets/fixtures/draft/mythic-selection.jpg", slot: 5 },
  { heroId: 27, heroName: "Sun", variant: "mirror-x" as const, url: "/assets/fixtures/draft/mythic-enemy-complete-training.jpg", slot: 4 },
];
const calibratedAllyInteriorTemplates = [
  { heroId: 16, heroName: "Zilong", variant: "normal" as const, url: "/assets/fixtures/draft/templates/ally-pick-zilong-face.jpg" },
];
const calibratedFinalPickFrameSamples = [
  { heroId: 8, heroName: "Karina", variant: "normal" as const, group: "allyPicks" as const, slot: 1 },
  { heroId: 16, heroName: "Zilong", variant: "normal" as const, group: "allyPicks" as const, slot: 2 },
  { heroId: 53, heroName: "Lesley", variant: "normal" as const, group: "allyPicks" as const, slot: 3 },
  { heroId: 83, heroName: "X.Borg", variant: "normal" as const, group: "allyPicks" as const, slot: 4 },
  { heroId: 91, heroName: "Cecilion", variant: "normal" as const, group: "allyPicks" as const, slot: 5 },
  { heroId: 46, heroName: "Odette", variant: "mirror-x" as const, group: "enemyPicks" as const, slot: 1 },
  { heroId: 60, heroName: "Hanabi", variant: "mirror-x" as const, group: "enemyPicks" as const, slot: 2 },
  { heroId: 90, heroName: "Silvanna", variant: "mirror-x" as const, group: "enemyPicks" as const, slot: 3 },
  { heroId: 27, heroName: "Sun", variant: "mirror-x" as const, group: "enemyPicks" as const, slot: 4 },
  { heroId: 7, heroName: "Alucard", variant: "mirror-x" as const, group: "enemyPicks" as const, slot: 5 },
].map((sample) => ({ ...sample, url: "/assets/fixtures/draft/mythic-skins-training.jpg" })).concat([
  { heroId: 60, heroName: "Hanabi", variant: "mirror-x" as const, group: "enemyPicks" as const, slot: 2, url: "/assets/fixtures/draft/mythic-skins-training-2.jpg" },
  { heroId: 60, heroName: "Hanabi", variant: "mirror-x" as const, group: "enemyPicks" as const, slot: 2, url: "/assets/fixtures/draft/mythic-skins-training-3.jpg" },
]);

type LoadedReferences = {
  icons: HeroIconReference[];
  basePickIcons: HeroIconReference[];
  overlayBasePickIcons: HeroIconReference[];
  bannerPortraits: HeroPortraitReference[];
  allyInteriorPortraits: HeroPortraitReference[];
  finalPickIcons: HeroIconReference[];
};

let referencesPromise: Promise<LoadedReferences> | null = null;
let referencesReady = false;
let recognitionInFlight = false;
let lastContextAttemptAt = 0;
let lastAttemptAt = 0;
let lastPostedAt = 0;
let lastFingerprint = "";
let accumulatedRecognition: Record<SlotGroup, SlotDetection[]> = {
  allyPicks: [],
  enemyPicks: [],
  allyBans: [],
  enemyBans: [],
};

export function configuredDraftBanIconSlots() {
  const rails = configuredRails();
  return Object.fromEntries(
    Object.entries(rails).filter(([, group]) => group.asset === "icon").map(([key, group]) => [
      key,
      Array.from({ length: group.count }, (_, index) => splitRect(group.rect, index, group.count, group.vertical)),
    ]),
  ) as Record<"allyBans" | "enemyBans", NormalizedRect[]>;
}

export function configuredDraftPickPortraitSlots() {
  const rails = configuredRails();
  return Object.fromEntries(
    Object.entries(rails).filter(([, group]) => group.asset === "portrait").map(([key, group]) => [
      key,
      Array.from({ length: group.count }, (_, index) => splitRect(group.rect, index, group.count, group.vertical)),
    ]),
  ) as Record<"allyPicks" | "enemyPicks", NormalizedRect[]>;
}

export function pickReferenceModelForVisibleSlots(visibleSlots: boolean[]) {
  return visibleSlots.length === 10 && visibleSlots.every(Boolean) ? "skin-icon" : "base-icon";
}

export function strongestAcceptedMatch(...candidates: Array<AcceptedHeroMatch | null>) {
  return candidates
    .filter((candidate): candidate is AcceptedHeroMatch => Boolean(candidate))
    .sort((left, right) => right.confidence - left.confidence)[0] ?? null;
}

export function queueDraftBanIconRecognition(
  canvas: HTMLCanvasElement,
  vision: LiveVisionFrame,
  source: SourceMode,
) {
  if (vision.screen === "lobby" || vision.screen === "scoreboard" || vision.screen === "item_shop") {
    if (source !== "recording") accumulatedRecognition = emptyRecognition();
    return;
  }
  if (vision.screen !== "draft" || vision.confidence < 0.55) {
    if (source !== "recording") accumulatedRecognition = emptyRecognition();
    return;
  }
  const now = performance.now();
  if (!referencesReady && now - lastContextAttemptAt >= 350) {
    lastContextAttemptAt = now;
    const context = detectDraftVisualContext(canvas);
    void postDetectedDraftFacts({ allyPicks: [], enemyPicks: [], allyBans: [], enemyBans: [] }, context, source, [], [], undefined, true).catch(() => {});
  }
  if (recognitionInFlight) return;
  if (now - lastAttemptAt < 900) return;
  lastAttemptAt = now;
  recognitionInFlight = true;
  void detectDraftFacts(canvas, source)
    .catch((error) => {
      if (source === "recording") console.warn("[draft-cv-error]", String(error));
    })
    .finally(() => {
      recognitionInFlight = false;
    });
}

async function detectDraftFacts(canvas: HTMLCanvasElement, source: SourceMode) {
  const references = await getReferences();
  if (!references.icons.length && !references.basePickIcons.length) return;
  const rails = configuredRails();
  const slots = Object.fromEntries(
    Object.entries(rails).map(([key, group]) => [
      key,
      Array.from({ length: group.count }, (_, index) => splitRect(group.rect, index, group.count, group.vertical)),
    ]),
  ) as Record<SlotGroup, NormalizedRect[]>;
  const recognition = emptyRecognition();
  const diagnostics: SlotDiagnostic[] = [];
  const pickReferenceModel = pickReferenceModelForVisibleSlots([...slots.allyPicks, ...slots.enemyPicks]
    .map((rect) => {
      const crop = cropForRect(canvas, rect);
      return Boolean(crop && hasVisibleDraftPortrait(crop.data));
    }));
  const finalPickPresentation = pickReferenceModel === "skin-icon";

  for (const group of Object.keys(slots) as SlotGroup[]) {
    for (const [slot, rect] of slots[group].entries()) {
      const crop = cropForRect(canvas, rect);
      if (!crop) continue;
      if (rails[group].asset === "icon") {
        const visible = hasVisibleDraftBanIcon(crop.data);
        if (!visible) {
          diagnostics.push({ group, slot: slot + 1, visible, candidates: [], accepted: null });
          continue;
        }
        const iconCrops = [0.72, 0.8, 0.88, 0.96]
          .flatMap((scale) => [0, 0.05].map((offsetX) => centerSquareCrop(crop, scale, offsetX)));
        // The outermost enemy ban icon sits farther right inside its rail cell in the recorded draft layout.
        iconCrops.push(relativeCrop(crop, [34 / 127, 10 / 113, 86 / 127, 86 / 113]));
        const ranking = iconCrops
          .flatMap((square) => rankIconCandidates(
            iconSignatureFromRgba(square.data, square.width, square.height),
            references.icons,
          ))
          .sort((left, right) => right.confidence - left.confidence);
        const accepted = acceptIconMatch(ranking);
        diagnostics.push({
          group,
          slot: slot + 1,
          visible,
          candidates: distinctCandidates(ranking),
          model: "ban-icon",
          accepted: accepted?.heroName ?? null,
        });
        if (accepted) recognition[group].push({ ...accepted, slot: slot + 1, source: "draft-ban-icon" });
      } else {
        const pickGroup = group as "allyPicks" | "enemyPicks";
        const visible = hasVisibleDraftPortrait(crop.data);
        if (!visible) {
          diagnostics.push({ group, slot: slot + 1, visible, candidates: [], accepted: null });
          continue;
        }
        // The tenth lock-in transition can mix original draft portraits and selected skin portraits.
        // Evaluate both models per slot instead of treating a filled rail as one uniform artwork type.
        const baseThumbnailRanking = basePickCrops(crop, pickGroup)
          .flatMap((faceCrop) => rankIconCandidates(
            iconSignatureFromRgba(faceCrop.data, faceCrop.width, faceCrop.height, PICK_ICON_GRID_SIZE),
            references.basePickIcons,
          ))
          .sort((left, right) => right.confidence - left.confidence);
        const skinThumbnailRanking = finalPickPresentation
          ? finalPickCrops(crop, pickGroup)
            .flatMap((faceCrop) => rankIconCandidates(
              iconSignatureFromRgba(faceCrop.data, faceCrop.width, faceCrop.height, PICK_ICON_GRID_SIZE),
              references.finalPickIcons,
            ))
            .sort((left, right) => right.confidence - left.confidence)
          : [];
        const baseThumbnailAccepted = acceptIconMatch(baseThumbnailRanking, BASE_PICK_MIN_CONFIDENCE, BASE_PICK_MIN_MARGIN);
        const skinThumbnailAccepted = finalPickPresentation
          ? acceptIconMatch(skinThumbnailRanking, FINAL_PICK_MIN_CONFIDENCE, FINAL_PICK_MIN_MARGIN)
          : null;
        const thumbnailAccepted = strongestAcceptedMatch(baseThumbnailAccepted, skinThumbnailAccepted);
        const usesSkinThumbnail = Boolean(thumbnailAccepted && skinThumbnailAccepted && thumbnailAccepted === skinThumbnailAccepted);
        const thumbnailRanking = usesSkinThumbnail ? skinThumbnailRanking : baseThumbnailRanking;
        const overlayRanking = pickGroup === "allyPicks"
          ? overlayBasePickCrops(crop)
            .flatMap((faceCrop) => rankIconCandidates(
              pickIconSignatureFromRgba(faceCrop.data, faceCrop.width, faceCrop.height, PICK_ICON_GRID_SIZE),
              references.overlayBasePickIcons,
            ))
            .sort((left, right) => right.confidence - left.confidence)
          : [];
        const overlayAccepted = acceptIconMatch(overlayRanking, OVERLAY_PICK_MIN_CONFIDENCE, OVERLAY_PICK_MIN_MARGIN);
        const interiorRanking = pickGroup === "allyPicks"
          ? allyInteriorCrops(crop)
            .flatMap((interiorCrop) => rankDraftBannerCandidates(
              resizedBannerSignature(interiorCrop),
              references.allyInteriorPortraits,
            ))
            .sort((left, right) => right.confidence - left.confidence)
          : [];
        const interiorAccepted = acceptPortraitMatch(interiorRanking, CALIBRATED_INTERIOR_MIN_CONFIDENCE, 0);
        const bannerRanking = (pickGroup === "enemyPicks" ? draftBannerCrops(crop) : allyBannerCrops(crop))
            .flatMap((bannerCrop) => rankDraftBannerCandidates(
              resizedBannerSignature(bannerCrop),
              references.bannerPortraits,
            ))
            .sort((left, right) => right.confidence - left.confidence)
          ;
        const bannerAccepted = acceptPortraitMatch(bannerRanking, BANNER_PICK_MIN_CONFIDENCE, BANNER_PICK_MIN_MARGIN);
        const accepted = pickGroup === "enemyPicks"
          ? strongestAcceptedMatch(thumbnailAccepted, bannerAccepted)
          : strongestAcceptedMatch(thumbnailAccepted, overlayAccepted, interiorAccepted, bannerAccepted);
        const acceptedFromOverlay = Boolean(accepted && overlayAccepted && accepted === overlayAccepted);
        const acceptedFromInterior = Boolean(accepted && interiorAccepted && accepted === interiorAccepted);
        const acceptedFromBanner = Boolean(accepted && bannerAccepted && accepted === bannerAccepted);
        const usesBannerModel = acceptedFromBanner || (pickGroup === "enemyPicks" && !thumbnailAccepted);
        const displayedRanking = usesBannerModel
          ? bannerRanking
          : acceptedFromInterior
          ? interiorRanking
          : acceptedFromOverlay || (!thumbnailRanking.length && overlayRanking.length)
          ? overlayRanking
          : thumbnailRanking;
        diagnostics.push({
          group,
          slot: slot + 1,
          visible,
          candidates: distinctCandidates(displayedRanking),
          model: usesBannerModel ? "base-portrait-banner" : acceptedFromInterior ? "calibrated-interior" : acceptedFromOverlay ? "base-icon-overlay" : usesSkinThumbnail ? "skin-icon" : "base-icon",
          thumbnailCandidates: distinctCandidates(thumbnailRanking),
          ...(bannerRanking.length ? { bannerCandidates: distinctCandidates(bannerRanking) } : {}),
          accepted: accepted?.heroName ?? null,
        });
        if (accepted) recognition[group].push({ ...accepted, slot: slot + 1, source: "draft-pick-portrait" });
      }
    }
  }
  if (source === "recording") console.info("[draft-cv-diagnostics]", JSON.stringify(diagnostics));

  const baseContext = detectDraftVisualContext(canvas);
  const auxiliary = await detectDraftAuxiliaryFacts(canvas, baseContext.selfSlot?.value, source === "recording");
  const context = { ...baseContext, ...(auxiliary.selectedLane ? { selectedLane: auxiliary.selectedLane } : {}) };
  const submittedRecognition = source === "recording"
    ? recognition
    : (accumulatedRecognition = mergeRecognition(accumulatedRecognition, recognition));
  await postDetectedDraftFacts(
    submittedRecognition,
    context,
    source,
    auxiliary.allySpells,
    auxiliary.allyLanes,
    source === "recording" ? diagnostics : undefined,
  );
}

function emptyRecognition(): Record<SlotGroup, SlotDetection[]> {
  return { allyPicks: [], enemyPicks: [], allyBans: [], enemyBans: [] };
}

function distinctCandidates(ranking: Array<{ heroName: string; confidence: number }>) {
  const seen = new Set<string>();
  return ranking.filter((candidate) => {
    if (seen.has(candidate.heroName)) return false;
    seen.add(candidate.heroName);
    return true;
  }).slice(0, 3).map(({ heroName, confidence }) => ({ heroName, confidence }));
}

async function postDetectedDraftFacts(
  recognition: Record<SlotGroup, SlotDetection[]>,
  context: ReturnType<typeof detectDraftVisualContext>,
  source: SourceMode,
  allySpells: Array<{ spell: string; slot: number; confidence: number; source: "draft-battle-spell-icon" }> = [],
  allyLanes: Array<{ lane: string; slot: number; confidence: number; source: "draft-lane-icon" }> = [],
  diagnostics?: SlotDiagnostic[],
  provisional = false,
) {
  const facts = [...Object.values(recognition).flat(), ...allyLanes, ...allySpells, ...Object.values(context)];
  if (!facts.length) return;
  const fingerprint = JSON.stringify(
    {
      ...Object.fromEntries(Object.entries(recognition).map(([key, entries]) => [key, entries.map((entry) => entry.heroId)])),
      selfSlot: context.selfSlot?.value,
      firstPickSide: context.firstPickSide?.value,
      selectedLane: context.selectedLane?.value,
      allySpells: allySpells.map((entry) => `${entry.slot}:${entry.spell}`),
      allyLanes: allyLanes.map((entry) => `${entry.slot}:${entry.lane}`),
    },
  );
  const now = Date.now();
  if (source !== "recording" && fingerprint === lastFingerprint && now - lastPostedAt < 4000) return;
  lastFingerprint = fingerprint;
  lastPostedAt = now;
  await ingestDraftRecognition({
    phase: "draft",
    ...recognition,
    allyLanes,
    allySpells,
    ...context,
    ...(provisional ? { provisional: true } : {}),
    ...(diagnostics ? { diagnostics } : {}),
    frameId: `${source}:${now}`,
    timestamp: now,
  });
}

function mergeRecognition(
  previous: Record<SlotGroup, SlotDetection[]>,
  next: Record<SlotGroup, SlotDetection[]>,
) {
  return Object.fromEntries(
    (Object.keys(previous) as SlotGroup[]).map((group) => {
      const merged = new Map(previous[group].map((entry) => [entry.slot, entry]));
      for (const entry of next[group]) {
        const existing = merged.get(entry.slot);
        if (!existing || entry.confidence > existing.confidence) merged.set(entry.slot, entry);
      }
      return [group, [...merged.values()].sort((left, right) => left.slot - right.slot)];
    }),
  ) as Record<SlotGroup, SlotDetection[]>;
}

function splitRect(rect: NormalizedRect, index: number, count: number, vertical: boolean): NormalizedRect {
  const [x, y, width, height] = rect;
  if (vertical) return [x, y + (height * index) / count, width, height / count];
  return [x + (width * index) / count, y, width / count, height];
}

function cropForRect(canvas: HTMLCanvasElement, rect: NormalizedRect) {
  const [x, y, width, height] = rect;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return null;
  return context.getImageData(
    Math.max(0, Math.round(x * canvas.width)),
    Math.max(0, Math.round(y * canvas.height)),
    Math.max(1, Math.round(width * canvas.width)),
    Math.max(1, Math.round(height * canvas.height)),
  );
}

function centerSquareCrop(crop: ImageData, scale = 1, horizontalOffset = 0) {
  const side = Math.max(1, Math.round(Math.min(crop.width, crop.height) * scale));
  const offsetX = Math.max(0, Math.min(crop.width - side, Math.floor((crop.width - side) / 2 + crop.width * horizontalOffset)));
  const offsetY = Math.floor((crop.height - side) / 2);
  const data = new Uint8ClampedArray(side * side * 4);
  for (let y = 0; y < side; y += 1) {
    const from = ((offsetY + y) * crop.width + offsetX) * 4;
    const to = y * side * 4;
    data.set(crop.data.subarray(from, from + side * 4), to);
  }
  return { data, width: side, height: side };
}

function relativeCrop(crop: ImageData, rect: NormalizedRect) {
  const left = Math.max(0, Math.round(rect[0] * crop.width));
  const top = Math.max(0, Math.round(rect[1] * crop.height));
  const width = Math.max(1, Math.min(crop.width - left, Math.round(rect[2] * crop.width)));
  const height = Math.max(1, Math.min(crop.height - top, Math.round(rect[3] * crop.height)));
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    const from = ((top + y) * crop.width + left) * 4;
    data.set(crop.data.subarray(from, from + width * 4), y * width * 4);
  }
  return { data, width, height };
}

export function hasVisibleDraftBanIcon(rgba: Uint8ClampedArray) {
  let sum = 0;
  let sumSquared = 0;
  let bright = 0;
  let sampled = 0;
  for (let index = 0; index < rgba.length; index += 12) {
    const luma = rgba[index] * 0.299 + rgba[index + 1] * 0.587 + rgba[index + 2] * 0.114;
    sum += luma;
    sumSquared += luma * luma;
    if (luma > 100) bright += 1;
    sampled += 1;
  }
  if (!sampled) return false;
  const mean = sum / sampled;
  const contrast = Math.sqrt(Math.max(0, sumSquared / sampled - mean * mean));
  return bright / sampled >= 0.16 && contrast >= 40;
}

export function hasVisibleDraftPortrait(rgba: Uint8ClampedArray) {
  let sum = 0;
  let sumSquared = 0;
  let sampled = 0;
  for (let index = 0; index < rgba.length; index += 16) {
    const luma = rgba[index] * 0.299 + rgba[index + 1] * 0.587 + rgba[index + 2] * 0.114;
    sum += luma;
    sumSquared += luma * luma;
    sampled += 1;
  }
  if (!sampled) return false;
  const mean = sum / sampled;
  const contrast = Math.sqrt(Math.max(0, sumSquared / sampled - mean * mean));
  return mean >= 18 && contrast >= 28;
}

async function getReferences() {
  if (!referencesPromise) referencesPromise = loadReferences();
  return referencesPromise;
}

async function loadReferences() {
  const response = await getHeroRecognitionManifest();
  const heroes = Array.isArray(response?.data?.heroes) ? response.data.heroes : [];
  const trainedResponse = await getDraftHeroModel().catch(() => null);
  const trained = trainedResponse?.data?.references;
  const icons: HeroIconReference[] = Array.isArray(trained?.banIcons) ? trained.banIcons : [];
  const basePickIcons: HeroIconReference[] = Array.isArray(trained?.basePickIcons) ? trained.basePickIcons : [];
  const overlayBasePickIcons: HeroIconReference[] = Array.isArray(trained?.overlayPickIcons) ? trained.overlayPickIcons : [];
  const officialSkinPickIcons: HeroIconReference[] = Array.isArray(trained?.skinPickIcons) ? trained.skinPickIcons : [];
  const trainedHeroIds = new Set(icons.map((entry) => entry.heroId));
  const bannerPortraits: HeroPortraitReference[] = [];
  const allyInteriorPortraits: HeroPortraitReference[] = [];
  const references: LoadedReferences = {
    icons,
    basePickIcons,
    overlayBasePickIcons,
    bannerPortraits,
    allyInteriorPortraits,
    finalPickIcons: [...officialSkinPickIcons, ...basePickIcons],
  };
  referencesReady = true;
  void enrichReferences(references, heroes, trainedHeroIds).catch(() => {});
  return references;
}

async function enrichReferences(
  references: LoadedReferences,
  heroes: any[],
  trainedHeroIds: Set<number>,
) {
  const { icons, basePickIcons, overlayBasePickIcons, bannerPortraits, allyInteriorPortraits, finalPickIcons } = references;
  for (let index = 0; index < heroes.length; index += 12) {
    const batch = heroes.slice(index, index + 12);
    const loaded = await Promise.all(batch.map(async (hero: any) => {
      const icon = trainedHeroIds.has(Number(hero.id))
        ? null
        : await loadImage(`/api/vision/heroes/draft-head/${hero.id}`) ?? await loadImage(`/api/vision/heroes/icon/${hero.id}`);
      const result = {
        icons: [] as HeroIconReference[],
        basePickIcons: [] as HeroIconReference[],
        overlayBasePickIcons: [] as HeroIconReference[],
        bannerPortraits: [] as HeroPortraitReference[],
      };
      if (icon) {
        const canvas = document.createElement("canvas");
        canvas.width = 64;
        canvas.height = 64;
        const context = canvas.getContext("2d", { willReadFrequently: true });
        if (context) {
          context.drawImage(icon, 0, 0, 64, 64);
          const normal = iconSignatureFromRgba(context.getImageData(0, 0, 64, 64).data, 64, 64);
          result.icons.push(
            { heroId: Number(hero.id), heroName: String(hero.name), variant: "normal", signature: normal },
            { heroId: Number(hero.id), heroName: String(hero.name), variant: "mirror-x", signature: mirrorIconSignature(normal) },
          );
          const pickNormal = iconSignatureFromRgba(context.getImageData(0, 0, 64, 64).data, 64, 64, PICK_ICON_GRID_SIZE);
          result.basePickIcons.push(
            { heroId: Number(hero.id), heroName: String(hero.name), variant: "normal", signature: pickNormal },
            { heroId: Number(hero.id), heroName: String(hero.name), variant: "mirror-x", signature: mirrorIconSignature(pickNormal, PICK_ICON_GRID_SIZE) },
          );
          const overlayNormal = pickIconSignatureFromRgba(context.getImageData(0, 0, 64, 64).data, 64, 64, PICK_ICON_GRID_SIZE);
          result.overlayBasePickIcons.push(
            { heroId: Number(hero.id), heroName: String(hero.name), variant: "normal", signature: overlayNormal },
            { heroId: Number(hero.id), heroName: String(hero.name), variant: "mirror-x", signature: mirrorIconSignature(overlayNormal, PICK_ICON_GRID_SIZE) },
          );
        }
      }
      const portrait = await loadImage(`/api/vision/heroes/portrait/${hero.id}`);
      if (portrait) {
        const canvas = document.createElement("canvas");
        canvas.width = BANNER_COLUMNS;
        canvas.height = BANNER_ROWS;
        const context = canvas.getContext("2d", { willReadFrequently: true });
        if (context) {
          for (const topRatio of [0, 20 / 390, 40 / 390, 60 / 390, 80 / 390, 100 / 390]) {
            context.clearRect(0, 0, canvas.width, canvas.height);
            context.drawImage(
              portrait,
              0,
              Math.round(portrait.naturalHeight * topRatio),
              portrait.naturalWidth,
              Math.round(portrait.naturalHeight * (150 / 390)),
              0,
              0,
              canvas.width,
              canvas.height,
            );
            const normal = draftBannerSignatureFromRgba(
              context.getImageData(0, 0, canvas.width, canvas.height).data,
              canvas.width,
              canvas.height,
              BANNER_COLUMNS,
              BANNER_ROWS,
            );
            result.bannerPortraits.push(
              { heroId: Number(hero.id), heroName: String(hero.name), variant: "normal", signature: normal },
              { heroId: Number(hero.id), heroName: String(hero.name), variant: "mirror-x", signature: mirrorDraftBannerSignature(normal) },
            );
          }
        }
      }
      return result;
    }));
    icons.push(...loaded.flatMap((entry) => entry.icons));
    basePickIcons.push(...loaded.flatMap((entry) => entry.basePickIcons));
    overlayBasePickIcons.push(...loaded.flatMap((entry) => entry.overlayBasePickIcons));
    bannerPortraits.push(...loaded.flatMap((entry) => entry.bannerPortraits));
  }
  const calibratedBanners = await Promise.all(calibratedEnemyBannerTemplates.map(async (template) => ({
    template,
    image: await loadImage(template.url),
  })));
  for (const { template, image } of calibratedBanners) {
    if (!image) continue;
    const canvas = document.createElement("canvas");
    canvas.width = BANNER_COLUMNS;
    canvas.height = BANNER_ROWS;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) continue;
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    bannerPortraits.push({
      heroId: template.heroId,
      heroName: template.heroName,
      variant: template.variant,
      signature: draftBannerSignatureFromRgba(
        context.getImageData(0, 0, canvas.width, canvas.height).data,
        canvas.width,
        canvas.height,
        BANNER_COLUMNS,
        BANNER_ROWS,
      ),
    });
  }
  const calibratedFrameSamples = await Promise.all(calibratedEnemyFrameSamples.map(async (sample) => ({
    sample,
    image: await loadImage(sample.url),
  })));
  for (const { sample, image } of calibratedFrameSamples) {
    if (!image) continue;
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) continue;
    context.drawImage(image, 0, 0);
    const slotRect = splitRect(defaultRails.enemyPicks.rect, sample.slot - 1, defaultRails.enemyPicks.count, true);
    const slotCrop = cropForRect(canvas, slotRect);
    if (!slotCrop) continue;
    for (const bannerCrop of draftBannerCrops(slotCrop)) {
      bannerPortraits.push({
        heroId: sample.heroId,
        heroName: sample.heroName,
        variant: sample.variant,
        signature: resizedBannerSignature(bannerCrop),
      });
    }
  }
  const calibratedInteriors = await Promise.all(calibratedAllyInteriorTemplates.map(async (template) => ({
    template,
    image: await loadImage(template.url),
  })));
  for (const { template, image } of calibratedInteriors) {
    if (!image) continue;
    const canvas = document.createElement("canvas");
    canvas.width = BANNER_COLUMNS;
    canvas.height = BANNER_ROWS;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) continue;
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    allyInteriorPortraits.push({
      heroId: template.heroId,
      heroName: template.heroName,
      variant: template.variant,
      signature: draftBannerSignatureFromRgba(
        context.getImageData(0, 0, canvas.width, canvas.height).data,
        canvas.width,
        canvas.height,
        BANNER_COLUMNS,
        BANNER_ROWS,
      ),
    });
  }
  const skinSignatures = await getSkinSignatureManifest().catch(() => null);
  const compiledReferences = Array.isArray(skinSignatures?.data?.references) ? skinSignatures.data.references : [];
  finalPickIcons.push(...compiledReferences
    .filter((reference: any) => reference.asset === "icon" && Number.isFinite(Number(reference.heroId)) && Array.isArray(reference.signature))
    .flatMap((reference: any) => {
      const signature = reference.signature.map(Number);
      const heroId = Number(reference.heroId);
      const heroName = String(reference.heroName);
      return [
        { heroId, heroName, variant: "normal" as const, signature },
        { heroId, heroName, variant: "mirror-x" as const, signature: mirrorIconSignature(signature, PICK_ICON_GRID_SIZE) },
      ];
    }));
  const calibratedFinalPicks = await Promise.all(calibratedFinalPickFrameSamples.map(async (sample) => ({
    sample,
    image: await loadImage(sample.url),
  })));
  for (const { sample, image } of calibratedFinalPicks) {
    if (!image) continue;
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) continue;
    context.drawImage(image, 0, 0);
    const slotRect = splitRect(defaultRails[sample.group].rect, sample.slot - 1, defaultRails[sample.group].count, true);
    const slotCrop = cropForRect(canvas, slotRect);
    if (!slotCrop) continue;
    for (const faceCrop of finalPickCrops(slotCrop, sample.group)) {
      finalPickIcons.push({
        heroId: sample.heroId,
        heroName: sample.heroName,
        variant: sample.variant,
        signature: iconSignatureFromRgba(faceCrop.data, faceCrop.width, faceCrop.height, PICK_ICON_GRID_SIZE),
      });
    }
  }
}

function basePickCrops(crop: ImageData, group: "allyPicks" | "enemyPicks") {
  const crops = [];
  const placements = group === "allyPicks" ? [
    [0.36, 0.04, 0.56],
    [0.36, 0.02, 0.58],
    [0.36, 0.12, 0.63],
    [0.35, 0.14, 0.625],
    [0.36, 0.1, 0.65],
  ] : [
    [0.21, 0.12, 0.63],
    [0.2, 0.14, 0.625],
    [0.19, 0.1, 0.65],
  ];
  for (const [xRatio, yRatio, scale] of placements) {
    const square = Math.max(1, Math.round(crop.height * scale));
    crops.push(squareCrop(crop, Math.round(crop.width * xRatio), Math.round(crop.height * yRatio), square));
  }
  return crops;
}

function overlayBasePickCrops(crop: ImageData) {
  const crops = [];
  for (const [xRatio, yRatio, scale] of [
    [0.36, 0.06, 0.56],
    [0.36, 0.06, 0.68],
    [0.36, 0.1, 0.68],
  ]) {
    const square = Math.max(1, Math.round(crop.height * scale));
    crops.push(squareCrop(crop, Math.round(crop.width * xRatio), Math.round(crop.height * yRatio), square));
  }
  return crops;
}

function draftBannerCrops(crop: ImageData) {
  const crops = [];
  for (const x of [110 / 451, 130 / 451, 150 / 451]) {
    crops.push(relativeCrop(crop, [x, 30 / 208, 240 / 451, 150 / 208]));
  }
  return crops;
}

function allyBannerCrops(crop: ImageData) {
  const crops = [];
  for (const x of [90 / 464, 110 / 464, 130 / 464, 150 / 464]) {
    crops.push(relativeCrop(crop, [x, 30 / 208, 240 / 464, 150 / 208]));
  }
  return crops;
}

function allyInteriorCrops(crop: ImageData) {
  return [relativeCrop(crop, [150 / 464, 42 / 208, 145 / 464, 112 / 208])];
}

function resizedBannerSignature(crop: { data: Uint8ClampedArray; width: number; height: number }) {
  const source = document.createElement("canvas");
  source.width = crop.width;
  source.height = crop.height;
  const sourceContext = source.getContext("2d", { willReadFrequently: true });
  const resized = document.createElement("canvas");
  resized.width = BANNER_COLUMNS;
  resized.height = BANNER_ROWS;
  const resizedContext = resized.getContext("2d", { willReadFrequently: true });
  if (!sourceContext || !resizedContext) return [];
  const imageData = sourceContext.createImageData(crop.width, crop.height);
  imageData.data.set(crop.data);
  sourceContext.putImageData(imageData, 0, 0);
  resizedContext.drawImage(source, 0, 0, resized.width, resized.height);
  return draftBannerSignatureFromRgba(
    resizedContext.getImageData(0, 0, resized.width, resized.height).data,
    resized.width,
    resized.height,
    BANNER_COLUMNS,
    BANNER_ROWS,
  );
}

function finalPickCrops(crop: ImageData, group: "allyPicks" | "enemyPicks") {
  const crops = [];
  for (const [xRatio, yRatio, scale] of [
    [0.37, 0.18, 0.58],
    [0.39, 0.22, 0.52],
    [0.39, 0.27, 0.52],
    [0.42, 0.27, 0.48],
  ]) {
    const square = Math.max(1, Math.round(crop.height * scale));
    crops.push(squareCrop(crop, Math.round(crop.width * xRatio), Math.round(crop.height * yRatio), square));
  }
  crops.push(...(group === "allyPicks"
    ? [relativeCrop(crop, [0.3, 0.04, 0.67, 0.72]), relativeCrop(crop, [0.33, 0.18, 0.58, 0.68])]
    : [relativeCrop(crop, [0.2, 0.04, 0.67, 0.72]), relativeCrop(crop, [0.22, 0.18, 0.62, 0.68])]));
  return crops;
}

function squareCrop(crop: ImageData, left: number, top: number, side: number) {
  const x = Math.max(0, Math.min(crop.width - side, left));
  const y = Math.max(0, Math.min(crop.height - side, top));
  const data = new Uint8ClampedArray(side * side * 4);
  for (let row = 0; row < side; row += 1) {
    const from = ((y + row) * crop.width + x) * 4;
    data.set(crop.data.subarray(from, from + side * 4), row * side * 4);
  }
  return { data, width: side, height: side };
}

function loadImage(url: string) {
  return new Promise<HTMLImageElement | null>((resolve) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = url;
  });
}
