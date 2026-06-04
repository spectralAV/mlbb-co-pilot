export type OfflineRegionKey = "equipment_window" | "attributes_window" | "scoreboard" | "minimap";
export type OfflineRegionMetrics = { mean: number; contrast: number; changed: number; active: boolean };
export type OfflineVisionScreenState =
  | "unknown"
  | "lobby"
  | "draft"
  | "loading"
  | "live_hud"
  | "death_replay"
  | "scoreboard"
  | "item_shop";

export type OfflineLayoutProfile = {
  id: string;
  label: string;
  aspectRatio: number;
  sourceWidth: number;
  sourceHeight: number;
  confidence: number;
};

export type OfflineVisionFrame = {
  screen: OfflineVisionScreenState;
  confidence: number;
  evidence: string[];
  layoutProfile: OfflineLayoutProfile;
};

const scoreboardBodyRect: [number, number, number, number] = [0.1, 0.13, 0.8, 0.78];
const offlineRegions: Array<{ key: OfflineRegionKey; rect: [number, number, number, number] }> = [
  { key: "equipment_window", rect: scoreboardBodyRect },
  { key: "attributes_window", rect: scoreboardBodyRect },
  { key: "scoreboard", rect: [0.32, 0, 0.36, 0.08] },
  { key: "minimap", rect: [0.02521, 0, 0.146359, 0.326563] },
];

const visionProbes: Array<{ key: string; rect: [number, number, number, number] }> = [
  { key: "top_hud", rect: [0.28, 0, 0.45, 0.08] },
  { key: "draft_left_rail", rect: [0, 0.08, 0.22, 0.84] },
  { key: "draft_right_rail", rect: [0.78, 0.08, 0.22, 0.84] },
  { key: "center_panel", rect: [0.27, 0.1, 0.48, 0.64] },
  { key: "modal_body", rect: [0.1, 0.13, 0.8, 0.78] },
];

const layoutProfiles = [
  { id: "phone_20_9", label: "20:9 phone", aspectRatio: 20 / 9 },
  { id: "phone_19_5_9", label: "19.5:9 phone", aspectRatio: 19.5 / 9 },
  { id: "phone_19_9", label: "19:9 phone", aspectRatio: 19 / 9 },
  { id: "video_16_9", label: "16:9 video", aspectRatio: 16 / 9 },
  { id: "tablet_3_2", label: "3:2 tablet", aspectRatio: 3 / 2 },
  { id: "tablet_4_3", label: "4:3 tablet", aspectRatio: 4 / 3 },
];

export function emptyOfflineMetrics(): Record<OfflineRegionKey, OfflineRegionMetrics> {
  return {
    equipment_window: { mean: 0, contrast: 0, changed: 0, active: false },
    attributes_window: { mean: 0, contrast: 0, changed: 0, active: false },
    scoreboard: { mean: 0, contrast: 0, changed: 0, active: false },
    minimap: { mean: 0, contrast: 0, changed: 0, active: false },
  };
}

export function selectOfflineLayoutProfile(width: number, height: number): OfflineLayoutProfile {
  const sourceWidth = Math.max(0, Number(width) || 0);
  const sourceHeight = Math.max(0, Number(height) || 0);
  const aspectRatio = sourceWidth > 0 && sourceHeight > 0 ? sourceWidth / sourceHeight : 0;
  const nearest = layoutProfiles
    .map((profile) => ({ ...profile, distance: Math.abs(profile.aspectRatio - aspectRatio) / profile.aspectRatio }))
    .sort((left, right) => left.distance - right.distance)[0];
  if (!nearest || !aspectRatio) {
    return { id: "custom", label: "Custom", aspectRatio, sourceWidth, sourceHeight, confidence: 0 };
  }
  const confidence = Math.max(0, Math.min(1, 1 - nearest.distance / 0.14));
  if (confidence < 0.45) {
    return { id: "custom", label: "Custom", aspectRatio, sourceWidth, sourceHeight, confidence: 1 - confidence };
  }
  return {
    id: nearest.id,
    label: nearest.label,
    aspectRatio,
    sourceWidth,
    sourceHeight,
    confidence,
  };
}

function sampleRect(
  data: Buffer,
  width: number,
  height: number,
  rect: [number, number, number, number],
): OfflineRegionMetrics {
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
      const luma = data[idx]! * 0.299 + data[idx + 1]! * 0.587 + data[idx + 2]! * 0.114;
      sum += luma;
      sumSq += luma * luma;
      count += 1;
    }
  }
  const mean = count ? sum / count : 0;
  const variance = count ? Math.max(0, sumSq / count - mean * mean) : 0;
  return { mean, contrast: Math.sqrt(variance), changed: 0, active: false };
}

function classifyOfflineVisionFrame(
  metrics: Record<OfflineRegionKey, OfflineRegionMetrics>,
  probes: Record<string, OfflineRegionMetrics>,
): Pick<OfflineVisionFrame, "screen" | "confidence" | "evidence"> {
  const evidence: string[] = [];
  const minimap = metrics.minimap;
  const topHud = probes.top_hud!;
  const leftRail = probes.draft_left_rail!;
  const rightRail = probes.draft_right_rail!;
  const center = probes.center_panel!;
  const modal = probes.modal_body!;
  const minimapVisible = minimap.contrast > 22 && minimap.mean > 12;
  const modalVisible =
    modal.contrast > 30 &&
    topHud.contrast < 20 &&
    (metrics.equipment_window.contrast > 30 || metrics.attributes_window.contrast > 30);
  const railsVisible = leftRail.contrast > 28 && rightRail.contrast > 28;
  const lobbyVisible =
    minimapVisible &&
    railsVisible &&
    topHud.mean > 55 &&
    center.mean > 95 &&
    center.contrast > 35;
  const phoneDarkDraftRails =
    minimapVisible &&
    leftRail.contrast > 1 &&
    rightRail.contrast > 1 &&
    leftRail.contrast < 20 &&
    rightRail.contrast < 20 &&
    center.mean < 60 &&
    center.contrast < 24 &&
    topHud.mean < 60;
  const phoneBrightDraftRails =
    minimapVisible &&
    leftRail.contrast > 18 &&
    rightRail.contrast > 18 &&
    leftRail.mean < 85 &&
    rightRail.mean < 85 &&
    center.mean >= 60 &&
    center.mean < 95 &&
    topHud.mean < 85 &&
    !lobbyVisible &&
    !modalVisible;
  const draftRailSignature = phoneDarkDraftRails || phoneBrightDraftRails;
  const completedDraftVisible =
    railsVisible &&
    center.contrast > 27 &&
    center.mean < 85 &&
    Math.max(leftRail.contrast, rightRail.contrast) > 38;

  if (modalVisible) {
    evidence.push("large scoreboard modal", "dimmed top HUD behind modal");
    return { screen: "scoreboard", confidence: 0.78, evidence };
  }
  if (lobbyVisible) {
    evidence.push("bright lobby center composition", "side navigation panels visible");
    return { screen: "lobby", confidence: 0.72, evidence };
  }
  if (draftRailSignature) {
    evidence.push(
      phoneDarkDraftRails ? "dark draft pick rails" : "bright draft pick rails",
      "decorative minimap suppressed for draft",
    );
    return { screen: "draft", confidence: phoneDarkDraftRails ? 0.64 : 0.7, evidence };
  }
  if (completedDraftVisible) {
    evidence.push("completed draft portrait rails", "center preparation region");
    return { screen: "draft", confidence: 0.72, evidence };
  }
  if (railsVisible && center.mean < 90 && center.contrast > 27 && (leftRail.mean < 78 || rightRail.mean < 78)) {
    evidence.push("draft side rails", "center selection region");
    return { screen: "draft", confidence: 0.68, evidence };
  }
  if (minimapVisible) {
    evidence.push("minimap texture detected");
    if (center.mean < 32 && topHud.mean < 38) {
      evidence.push("dimmed center and HUD");
      return { screen: "death_replay", confidence: 0.54, evidence };
    }
    return { screen: "live_hud", confidence: 0.6, evidence };
  }
  if (center.contrast > 36 && topHud.contrast < 24) {
    evidence.push("large center composition without live HUD");
    return { screen: "loading", confidence: 0.4, evidence };
  }
  evidence.push("no stable screen signature yet");
  return { screen: "unknown", confidence: 0.2, evidence };
}

export function classifyOfflineFramePixels(data: Buffer, width: number, height: number): OfflineVisionFrame {
  const metrics = emptyOfflineMetrics();
  for (const region of offlineRegions) metrics[region.key] = sampleRect(data, width, height, region.rect);
  const probes: Record<string, OfflineRegionMetrics> = {};
  for (const probe of visionProbes) probes[probe.key] = sampleRect(data, width, height, probe.rect);
  const layoutProfile = selectOfflineLayoutProfile(width, height);
  const classified = classifyOfflineVisionFrame(metrics, probes);
  return { ...classified, layoutProfile };
}
