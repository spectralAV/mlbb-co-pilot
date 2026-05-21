import fs from "node:fs/promises";
import path from "node:path";
import { analyzeDraft } from "../engines/draftEngine.js";

const ROOT = path.resolve(process.cwd(), "..");
const OBS_DIR = path.resolve(ROOT, "data", "obs");
const REGIONS_FILE = path.join(OBS_DIR, "screen_regions.json");
const CONFIG_FILE = path.join(OBS_DIR, "obs_config.json");

type CoachState = {
  role: string;
  ally_bans: string[];
  enemy_bans: string[];
  ally_picks: string[];
  enemy_picks: string[];
  enemy_items: string[];
  phase: string;
};

let state: CoachState = {
  role: "jungle",
  ally_bans: [],
  enemy_bans: [],
  ally_picks: ["Tigreal", "Lylia"],
  enemy_picks: ["Lesley", "Estes", "Alpha"],
  enemy_items: [],
  phase: "draft"
};

let obsRealtime = false;

async function ensureObsDir() {
  await fs.mkdir(OBS_DIR, { recursive: true });
}

async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    await ensureObsDir();
    return JSON.parse(await fs.readFile(file, "utf8")) as T;
  } catch {
    return fallback;
  }
}

async function writeJson(file: string, data: unknown) {
  await ensureObsDir();
  await fs.writeFile(file, JSON.stringify(data, null, 2), "utf8");
}

function mapAwareness(role: string) {
  const missingEnemyCount = 5;
  const callouts = ["Careful: 3+ enemies missing. Avoid face-checking river or bush."];
  const suggestions = ["Play near vision or minion wave until enemies show."];
  if (role === "jungle") {
    callouts.push("Track buff timers before Turtle or Lord setup.");
    suggestions.push("Do not start objective if enemy mid or roam is missing.");
  }
  return {
    ok: true,
    visible_enemies: [],
    missing_enemy_count: missingEnemyCount,
    buff_timers: { our_blue: null, our_red: null, enemy_blue: null, enemy_red: null },
    callouts,
    suggestions,
    timestamp: Date.now()
  };
}

function buildOverlaySummary(draft: any, mapState: any) {
  const best = draft?.bestPick;
  return {
    mode: state.phase,
    bestPick: best?.hero ?? "",
    confidence: best?.score ?? 0,
    reason: best?.reasons?.[0] ?? "Waiting for draft recommendation.",
    warning: mapState.callouts?.[0] ?? "",
    updatedAt: new Date().toISOString()
  };
}

export async function getObsCoachState() {
  const mapState = mapAwareness(state.role);
  const draft = await analyzeDraft({
    myRole: state.role,
    allyPicks: state.ally_picks,
    enemyPicks: state.enemy_picks,
    allyBans: state.ally_bans,
    enemyBans: state.enemy_bans,
    bans: [...state.ally_bans, ...state.enemy_bans]
  });
  const topPicks = [draft.bestPick, ...(draft.backupPicks ?? [])].filter(Boolean).map((pick: any) => ({
    hero: pick.hero,
    score: pick.score,
    reasons: pick.reasons ?? [],
    risks: pick.risks ?? []
  }));
  const recommendation = {
    role: state.role,
    ally_bans: state.ally_bans,
    enemy_bans: state.enemy_bans,
    enemy_picks: state.enemy_picks,
    ally_picks: state.ally_picks,
    top_picks: topPicks,
    threats: draft.avoidPicks?.map((pick: any) => pick.reason) ?? [],
    item_adjustments: mapState.suggestions,
    notes: [...(draft.bestPick?.reasons ?? []), ...mapState.callouts].slice(0, 5),
    map_callouts: mapState.callouts,
    draft
  };
  return {
    ok: true,
    state,
    recommendation,
    map_state: mapState,
    overlay: buildOverlaySummary(draft, mapState),
    obs_realtime_enabled: obsRealtime,
    reader_status: { ok: false, mode: "prepared", message: "OBS capture adapter is not connected yet." }
  };
}

export function setObsCoachState(next: Partial<CoachState>) {
  state = {
    role: String(next.role ?? state.role ?? "jungle").toLowerCase(),
    ally_bans: next.ally_bans ?? state.ally_bans,
    enemy_bans: next.enemy_bans ?? state.enemy_bans,
    ally_picks: next.ally_picks ?? state.ally_picks,
    enemy_picks: next.enemy_picks ?? state.enemy_picks,
    enemy_items: next.enemy_items ?? state.enemy_items,
    phase: next.phase ?? state.phase
  };
  return state;
}

export function setObsRealtime(enabled: boolean) {
  obsRealtime = enabled;
  return obsRealtime;
}

export function getObsRealtime() {
  return obsRealtime;
}

export async function getObsRegions() {
  return readJson(REGIONS_FILE, {});
}

export async function saveObsRegions(regions: unknown) {
  await writeJson(REGIONS_FILE, regions);
  return regions;
}

export async function addObsRegion(key: string, region: number[]) {
  const regions: any = await getObsRegions();
  if (key === "minimap_norm") regions[key] = region;
  else {
    regions[key] = Array.isArray(regions[key]) ? regions[key] : [];
    regions[key].push(region);
  }
  await saveObsRegions(regions);
  return regions;
}

export async function clearObsRegions(key: string) {
  const regions: any = await getObsRegions();
  if (key === "all") {
    for (const regionKey of ["ally_bans_norm", "enemy_bans_norm", "ally_picks_norm", "enemy_picks_norm", "scoreboard_norm", "items_norm"]) regions[regionKey] = [];
  } else if (key in regions) {
    regions[key] = key === "minimap_norm" ? [] : [];
  }
  await saveObsRegions(regions);
  return regions;
}

export async function getObsConfig() {
  return readJson(CONFIG_FILE, {});
}

export async function saveObsConfig(config: unknown) {
  await writeJson(CONFIG_FILE, config);
  return config;
}
