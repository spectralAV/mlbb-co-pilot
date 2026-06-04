export type YoloGatedScreen =
  | "unknown"
  | "lobby"
  | "draft"
  | "loading"
  | "live_hud"
  | "death_replay"
  | "scoreboard"
  | "item_shop";

export type YoloDetectionLike = {
  className: string;
  confidence: number;
  bbox: [number, number, number, number];
  center: [number, number];
};

const DRAFT_CLASSES = new Set([
  "draft_screen",
  "ally_pick_slot",
  "enemy_pick_slot",
  "ally_ban_slot",
  "enemy_ban_slot",
  "lane_marker",
  "battle_spell_marker",
]);

const LIVE_HUD_CLASSES = new Set([
  "minimap_panel",
  "ally_hero_marker",
  "enemy_hero_marker",
  "turtle",
  "lord",
  "ally_turret",
  "enemy_turret",
  "turtle_respawn_timer",
  "lord_respawn_timer",
  "enemy_respawn_timer",
  "ally_respawn_timer",
  "minimap_objective_timer",
  "score_counter",
  "match_timer",
  "ally_kill_counter",
  "enemy_kill_counter",
  "personal_kda",
  "personal_gold_counter",
  "live_hud_stats_region",
  "red_buff",
  "blue_buff",
  "jungle_creep",
  "little_wonder",
]);

const SCOREBOARD_CLASSES = new Set([
  "equipment_scoreboard",
  "attributes_scoreboard",
  "post_match_item_slot",
]);

const SCREEN_CLASS_ALLOW: Partial<Record<YoloGatedScreen, Set<string>>> = {
  draft: DRAFT_CLASSES,
  live_hud: LIVE_HUD_CLASSES,
  scoreboard: SCOREBOARD_CLASSES,
  item_shop: LIVE_HUD_CLASSES,
  death_replay: LIVE_HUD_CLASSES,
};

export function yoloClassesForScreen(screen: YoloGatedScreen): Set<string> | null {
  return SCREEN_CLASS_ALLOW[screen] ?? null;
}

export function shouldQueueUltralyticsInference(screen: YoloGatedScreen): boolean {
  if (screen === "loading" || screen === "lobby") return false;
  return Boolean(SCREEN_CLASS_ALLOW[screen]);
}

export function filterYoloDetectionsForScreen<T extends YoloDetectionLike>(
  detections: T[],
  screen: YoloGatedScreen,
  minConfidence = 0.45,
): T[] {
  const allowed = SCREEN_CLASS_ALLOW[screen];
  if (!allowed) return [];
  return detections.filter((detection) =>
    allowed.has(detection.className) && detection.confidence >= minConfidence,
  );
}

export function minimapPanelRectFromYolo(
  detections: YoloDetectionLike[],
  fallback: [number, number, number, number],
  minConfidence = 0.45,
): [number, number, number, number] {
  const panel = detections
    .filter((detection) => detection.className === "minimap_panel" && detection.confidence >= minConfidence)
    .sort((left, right) => right.confidence - left.confidence)[0];
  return panel?.bbox ?? fallback;
}
