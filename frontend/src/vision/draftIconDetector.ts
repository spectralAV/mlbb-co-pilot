import { agentDebugLog, getDraftBannerModel, getDraftFeedbackStatus, getDraftHeroModel, ingestDraftRecognition } from "../api/client";
import { recognitionPayloadFingerprint } from "./draftRosterFingerprint";
import type { LiveVisionFrame, SourceMode } from "../runtime/captureRuntime";
import {
  acceptBanIconMatch,
  iconSignatureFromRgba,
  rankOrientedIconCandidates,
  type HeroIconReference,
} from "./iconMatcher";
import { detectDraftVisualContext } from "./draftContextDetector";
import { detectDraftAuxiliaryFacts } from "./draftAuxDetector";
import { calibratedRectForKeys } from "./calibrationRegions";
import {
  countYoloDraftSlots,
  resolveDraftSlotRects,
  resolveSlotGeometrySource,
  yoloBoxesForGroup,
  type YoloDraftDetection,
} from "./draftYoloSlots";
import {
  acceptPortraitMatch,
  draftBannerSignatureFromRgba,
  mirrorDraftBannerSignature,
  rankOrientedDraftBannerCandidates,
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
  model?: "ban-icon" | "portrait-banner" | "calibrated-interior";
  geometrySource?: "yolo" | "calibrated" | "default";
  thumbnailCandidates?: Array<{ heroName: string; confidence: number }>;
  bannerCandidates?: Array<{ heroName: string; confidence: number }>;
  accepted: string | null;
};

const PICK_ICON_GRID_SIZE = 8;
const BANNER_PICK_MIN_CONFIDENCE = 0.78;
const BANNER_PICK_MIN_MARGIN = 0.012;
const CALIBRATED_INTERIOR_MIN_CONFIDENCE = 0.95;
const BANNER_COLUMNS = 30;
const BANNER_ROWS = 20;
const defaultRails: Record<SlotGroup, { rect: NormalizedRect; count: number; vertical: boolean; asset: "icon" | "portrait" }> = {
  allyPicks: { rect: [0, 0.083042, 0.162621, 0.832224], count: 5, vertical: true, asset: "portrait" },
  enemyPicks: { rect: [0.842233, 0.084847, 0.157767, 0.828613], count: 5, vertical: true, asset: "portrait" },
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
let draftFeedbackCache = {
  approved: false,
  fingerprint: null as string | null,
  deniedFingerprints: [] as string[],
  fetchedAt: 0,
};
let lastContentFingerprint = "";
let lastContextAttemptAt = 0;
let lastAttemptAt = 0;
let lastPostedAt = 0;
let lastFingerprint = "";
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
  void visibleSlots;
  // Draft picks are full portrait strips; ban rows use head icons only.
  return "portrait-banner";
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
  yoloDetections?: YoloDraftDetection[],
  options?: { yoloFresh?: boolean },
) {
  if (vision.screen === "lobby" || vision.screen === "scoreboard" || vision.screen === "item_shop") {
    return;
  }
  if (vision.screen !== "draft" || vision.confidence < 0.55) {
    agentDebugLog("G", "draftIconDetector.ts:queueSkip", "Draft CV skipped", {
      screen: vision.screen,
      confidence: vision.confidence,
      referencesReady,
    });
    return;
  }
  const now = performance.now();
  if (!referencesReady && now - lastContextAttemptAt >= 350) {
    lastContextAttemptAt = now;
    const context = detectDraftVisualContext(canvas);
    void postDetectedDraftFacts({ allyPicks: [], enemyPicks: [], allyBans: [], enemyBans: [] }, context, source, [], [], undefined, true).catch(() => {});
  }
  if (recognitionInFlight) return;
  if (!options?.yoloFresh && now - lastAttemptAt < 900) return;
  void refreshDraftFeedbackCache().then((cache) => {
    if (cache.approved && cache.fingerprint && cache.fingerprint === lastContentFingerprint) return;
    lastAttemptAt = now;
    recognitionInFlight = true;
    const detections = yoloDetections ?? vision.signals?.yoloDetections;
    void detectDraftFacts(canvas, source, detections)
    .catch((error) => {
      if (source === "recording") console.warn("[draft-cv-error]", String(error));
    })
    .finally(() => {
      recognitionInFlight = false;
    });
  });
}

async function refreshDraftFeedbackCache() {
  if (performance.now() - draftFeedbackCache.fetchedAt < 3500) return draftFeedbackCache;
  try {
    const response = await getDraftFeedbackStatus();
    const data = response?.data ?? {};
    draftFeedbackCache = {
      approved: Boolean(data.approved),
      fingerprint: typeof data.fingerprint === "string" ? data.fingerprint : null,
      deniedFingerprints: Array.isArray(data.deniedFingerprints) ? data.deniedFingerprints : [],
      fetchedAt: performance.now(),
    };
  } catch {
    draftFeedbackCache.fetchedAt = performance.now();
  }
  return draftFeedbackCache;
}

function contentFingerprint(
  recognition: Record<SlotGroup, SlotDetection[]>,
  context: ReturnType<typeof detectDraftVisualContext>,
) {
  return recognitionPayloadFingerprint({
    phase: "draft",
    allyPicks: recognition.allyPicks.map((entry) => ({ heroId: entry.heroId, slot: entry.slot })),
    enemyPicks: recognition.enemyPicks.map((entry) => ({ heroId: entry.heroId, slot: entry.slot })),
    allyBans: recognition.allyBans.map((entry) => ({ heroId: entry.heroId, slot: entry.slot })),
    enemyBans: recognition.enemyBans.map((entry) => ({ heroId: entry.heroId, slot: entry.slot })),
    selectedLane: context.selectedLane,
    selfSlot: context.selfSlot,
    firstPickSide: context.firstPickSide,
  });
}

async function detectDraftFacts(
  canvas: HTMLCanvasElement,
  source: SourceMode,
  yoloDetections?: YoloDraftDetection[],
) {
  const references = await getReferences();
  if (!references.icons.length && !references.bannerPortraits.length) {
    agentDebugLog("H", "draftIconDetector.ts:detectDraftFacts", "Draft CV aborted — references empty", {
      banIcons: references.icons.length,
      bannerPortraits: references.bannerPortraits.length,
    });
    return;
  }
  const rails = configuredRails();
  const defaultOnlyRails = {
    allyPicks: defaultRails.allyPicks,
    enemyPicks: defaultRails.enemyPicks,
    allyBans: defaultRails.allyBans,
    enemyBans: defaultRails.enemyBans,
  };
  const defaultSlots = resolveDraftSlotRects(defaultOnlyRails, undefined) as Record<SlotGroup, NormalizedRect[]>;
  const slots = resolveDraftSlotRects(rails, yoloDetections) as Record<SlotGroup, NormalizedRect[]>;
  const yoloSlotCount = countYoloDraftSlots(yoloDetections);
  const recognition = emptyRecognition();
  const diagnostics: SlotDiagnostic[] = [];
  for (const group of Object.keys(slots) as SlotGroup[]) {
    const yoloSlotRects = yoloBoxesForGroup(group, yoloDetections ?? [], undefined, rails[group].count);
    for (const [slot, rect] of slots[group].entries()) {
      const geometrySource = resolveSlotGeometrySource(rect, defaultSlots[group][slot], yoloSlotRects[slot]);
      const crop = cropForRect(canvas, rect);
      if (!crop) continue;
      if (rails[group].asset === "icon") {
        const visible = hasVisibleDraftBanIcon(crop.data);
        if (!visible) {
          diagnostics.push({ group, slot: slot + 1, visible, candidates: [], accepted: null, geometrySource });
          continue;
        }
        const iconCrops = banIconCrops(crop, group, slot);
        const ranking = iconCrops
          .flatMap((square) => rankOrientedIconCandidates(
            iconSignatureFromRgba(square.data, square.width, square.height),
            references.icons,
          ))
          .sort((left, right) => right.confidence - left.confidence);
        const accepted = acceptBanIconMatch(ranking);
        if (group === "allyBans" && slot === 2 && ranking[0]?.heroName === "Gloo" && !accepted) {
          agentDebugLog("H3", "draftIconDetector.ts:banSlot3", "Gloo top ban match rejected", {
            top: ranking.slice(0, 3).map((entry) => ({ hero: entry.heroName, conf: entry.confidence })),
            visible,
          });
        }
        // #endregion
        diagnostics.push({
          group,
          slot: slot + 1,
          visible,
          candidates: distinctCandidates(ranking),
          model: "ban-icon",
          geometrySource,
          accepted: accepted?.heroName ?? null,
        });
        if (accepted) recognition[group].push({ ...accepted, slot: slot + 1, source: "draft-ban-icon" });
      } else {
        const pickGroup = group as "allyPicks" | "enemyPicks";
        const visible = hasVisibleDraftPortrait(crop.data);
        if (!visible) {
          diagnostics.push({ group, slot: slot + 1, visible, candidates: [], accepted: null, geometrySource });
          continue;
        }
        const bannerRanking = (pickGroup === "enemyPicks" ? draftBannerCrops(crop) : allyBannerCrops(crop))
          .flatMap((bannerCrop) => rankOrientedDraftBannerCandidates(
            resizedBannerSignature(bannerCrop),
            references.bannerPortraits,
          ))
          .sort((left, right) => right.confidence - left.confidence);
        const bannerAccepted = acceptPortraitMatch(bannerRanking, BANNER_PICK_MIN_CONFIDENCE, BANNER_PICK_MIN_MARGIN);
        const interiorRanking = pickGroup === "allyPicks"
          ? allyInteriorCrops(crop)
            .flatMap((interiorCrop) => rankOrientedDraftBannerCandidates(
              resizedBannerSignature(interiorCrop),
              references.allyInteriorPortraits,
            ))
            .sort((left, right) => right.confidence - left.confidence)
          : [];
        const interiorAccepted = acceptPortraitMatch(interiorRanking, CALIBRATED_INTERIOR_MIN_CONFIDENCE, 0);
        const accepted = strongestAcceptedMatch(bannerAccepted, interiorAccepted);
        const acceptedFromInterior = Boolean(accepted && interiorAccepted && accepted === interiorAccepted);
        diagnostics.push({
          group,
          slot: slot + 1,
          visible,
          candidates: distinctCandidates(acceptedFromInterior ? interiorRanking : bannerRanking),
          model: acceptedFromInterior ? "calibrated-interior" : "portrait-banner",
          geometrySource,
          bannerCandidates: distinctCandidates(bannerRanking),
          accepted: accepted?.heroName ?? null,
        });
        if (accepted) recognition[group].push({ ...accepted, slot: slot + 1, source: "draft-pick-portrait" });
      }
    }
  }
  if (source === "recording") console.info("[draft-cv-diagnostics]", JSON.stringify(diagnostics));

  agentDebugLog("E", "draftIconDetector.ts:detectDraftFacts", "Draft slot CV summary", {
    canvas: { w: canvas.width, h: canvas.height },
    yoloSlotCount,
    refs: {
      banIcons: references.icons.length,
      bannerPortraits: references.bannerPortraits.length,
      allyInteriorPortraits: references.allyInteriorPortraits.length,
    },
    slots: diagnostics.map((entry) => {
      const match = recognition[entry.group].find((fact) => fact.slot === entry.slot);
      return {
        g: entry.group,
        s: entry.slot,
        vis: entry.visible,
        a: entry.accepted,
        vr: match?.variant ?? null,
        m: entry.model,
        b1: entry.bannerCandidates?.[0],
      };
    }),
    accepted: Object.fromEntries(
      (Object.keys(recognition) as SlotGroup[]).map((group) => [
        group,
        recognition[group].map((entry) => ({ slot: entry.slot, hero: entry.heroName, conf: entry.confidence })),
      ]),
    ),
  });

  const baseContext = detectDraftVisualContext(canvas);
  const auxiliary = await detectDraftAuxiliaryFacts(canvas, baseContext.selfSlot?.value, source === "recording");
  const context = { ...baseContext, ...(auxiliary.selectedLane ? { selectedLane: auxiliary.selectedLane } : {}) };
  const feedback = await refreshDraftFeedbackCache();
  const contentFp = contentFingerprint(recognition, context);
  if (feedback.approved && feedback.fingerprint === contentFp) return;
  if (feedback.deniedFingerprints.includes(contentFp)) return;
  lastContentFingerprint = contentFp;
  // Live draft: per-frame snapshot so missed bans and pre-lock hero swaps can clear or move slots.
  await postDetectedDraftFacts(
    recognition,
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
  const contentFp = contentFingerprint(recognition, context);
  const feedback = await refreshDraftFeedbackCache();
  if (feedback.approved && feedback.fingerprint === contentFp) return;
  if (feedback.deniedFingerprints.includes(contentFp)) return;
  lastContentFingerprint = contentFp;
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

function banIconCrops(crop: ImageData, group: SlotGroup, slotIndex: number) {
  const iconCrops = [0.72, 0.8, 0.88, 0.96]
    .flatMap((scale) => [0, 0.05, -0.05].map((offsetX) => centerSquareCrop(crop, scale, offsetX)));
  if (group === "enemyBans") {
    // The outermost enemy ban icon sits farther right inside its rail cell in the recorded draft layout.
    iconCrops.push(relativeCrop(crop, [34 / 127, 10 / 113, 86 / 127, 86 / 113]));
  }
  if (group === "allyBans") {
    iconCrops.push(relativeCrop(crop, [0, 0.08, 0.9, 0.88]));
    iconCrops.push(relativeCrop(crop, [0.04, 0.1, 0.84, 0.84]));
    if (slotIndex >= 1 && slotIndex <= 3) {
      iconCrops.push(relativeCrop(crop, [0.06, 0.12, 0.8, 0.8]));
    }
  }
  return iconCrops;
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

export function preloadDraftRecognitionModels() {
  void getReferences();
}

async function getReferences() {
  if (!referencesPromise) referencesPromise = loadReferences();
  return referencesPromise;
}

async function loadReferences() {
  const [trainedResponse, bannerResponse] = await Promise.all([
    getDraftHeroModel().catch(() => null),
    getDraftBannerModel().catch(() => null),
  ]);
  const trained = trainedResponse?.data?.references;
  const icons: HeroIconReference[] = Array.isArray(trained?.banIcons) ? trained.banIcons : [];
  const serverBannerRefs: HeroPortraitReference[] = Array.isArray(bannerResponse?.data?.references)
    ? bannerResponse.data.references.map((entry: HeroPortraitReference) => ({
      heroId: entry.heroId,
      heroName: entry.heroName,
      variant: entry.variant ?? "normal",
      signature: entry.signature,
    }))
    : [];
  const bannerPortraits: HeroPortraitReference[] = serverBannerRefs.length
    ? serverBannerRefs
    : [];
  const references: LoadedReferences = {
    icons,
    basePickIcons: [],
    overlayBasePickIcons: [],
    bannerPortraits,
    allyInteriorPortraits: [],
    finalPickIcons: [],
  };
  await enrichCalibratedReferences(references);
  referencesReady = true;
  agentDebugLog("H", "draftIconDetector.ts:loadReferences", "Draft references loaded", {
    banIcons: icons.length,
    bannerPortraits: references.bannerPortraits.length,
  });
  return references;
}

async function enrichCalibratedReferences(references: LoadedReferences) {
  const { bannerPortraits, allyInteriorPortraits } = references;
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

const BANNER_Y_RATIOS = [0, 20 / 208, 40 / 208, 60 / 208, 80 / 208, 100 / 208];

function railBannerCrops(crop: ImageData, xRatios: number[], widthRatio: number) {
  const crops = [];
  for (const x of xRatios) {
    for (const y of BANNER_Y_RATIOS) {
      crops.push(relativeCrop(crop, [x, y, widthRatio, 150 / 208]));
    }
  }
  return crops;
}

function draftBannerCrops(crop: ImageData) {
  return railBannerCrops(crop, [110 / 451, 130 / 451, 150 / 451], 240 / 451);
}

function allyBannerCrops(crop: ImageData) {
  return railBannerCrops(crop, [90 / 464, 110 / 464, 130 / 464, 150 / 464], 240 / 464);
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
