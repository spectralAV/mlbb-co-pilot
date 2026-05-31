import { cache } from "./cacheService.js";

export type DraftLane = "exp" | "jungle" | "mid" | "roam" | "gold";

export type HeroPerformance = {
  hero: string;
  matches: number;
  wins: number;
  winRate: number;
  bestScore?: number;
  source: "rone" | "manual" | "imported";
  scope?: "current-season" | "overall";
  seasonId?: number;
};

export type PlayerProfile = {
  displayName: string;
  rankProfile: string;
  preferredLane: DraftLane;
  comfortHeroes: string[];
  heroPerformance: HeroPerformance[];
};

const file = "player-profile.json";
const defaultProfile: PlayerProfile = {
  displayName: "Rokas",
  rankProfile: "Mythic",
  preferredLane: "jungle",
  comfortHeroes: [],
  heroPerformance: [],
};

function normalizeLane(value: unknown): DraftLane {
  const lane = String(value ?? "").trim().toLowerCase().replace(/\s+lane$/, "");
  return (["exp", "jungle", "mid", "roam", "gold"] as DraftLane[]).includes(lane as DraftLane)
    ? lane as DraftLane
    : defaultProfile.preferredLane;
}

function normalizeHeroes(value: unknown) {
  const source = Array.isArray(value) ? value : String(value ?? "").split(",");
  return [...new Set(source.map((hero) => String(hero).trim()).filter(Boolean))].slice(0, 30);
}

function numberValue(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function percentValue(value: unknown) {
  const parsed = numberValue(value);
  if (parsed <= 0) return 0;
  return parsed <= 1 ? parsed * 100 : Math.min(100, parsed);
}

function normalizeHeroPerformance(value: unknown): HeroPerformance[] {
  const source = Array.isArray(value) ? value : [];
  const seen = new Set<string>();
  const result: HeroPerformance[] = [];

  for (const entry of source) {
    const item = entry as Partial<HeroPerformance> & Record<string, unknown>;
    const hero = String(item?.hero ?? item?.name ?? item?.heroName ?? "").trim();
    const scope = item?.scope === "overall" ? "overall" : item?.scope === "current-season" ? "current-season" : undefined;
    const seasonId = Math.max(0, Math.round(numberValue(item?.seasonId)));
    const key = [hero.toLowerCase(), scope ?? "profile", seasonId || ""].join(":");
    if (!hero || seen.has(key)) continue;

    const matches = Math.max(0, Math.round(numberValue(item?.matches ?? item?.totalMatches ?? item?.tc)));
    const rawWins = Math.max(0, Math.round(numberValue(item?.wins ?? item?.wc)));
    const wins = matches > 0 ? Math.min(matches, rawWins) : rawWins;
    const fallbackWinRate = matches > 0 ? (wins / matches) * 100 : 0;
    const winRate = percentValue(item?.winRate ?? item?.wr ?? fallbackWinRate);
    const bestScore = numberValue(item?.bestScore ?? item?.bs);
    const sourceValue = item?.source === "manual" || item?.source === "imported" ? item.source : "rone";

    result.push({
      hero,
      matches,
      wins,
      winRate,
      ...(bestScore > 0 ? { bestScore } : {}),
      source: sourceValue,
      ...(scope ? { scope } : {}),
      ...(seasonId > 0 ? { seasonId } : {}),
    });
    seen.add(key);
  }

  return result.slice(0, 60);
}

function normalizeProfile(value: Partial<PlayerProfile> | null | undefined): PlayerProfile {
  return {
    displayName: String(value?.displayName ?? defaultProfile.displayName).trim() || defaultProfile.displayName,
    rankProfile: String(value?.rankProfile ?? defaultProfile.rankProfile).trim() || defaultProfile.rankProfile,
    preferredLane: normalizeLane(value?.preferredLane),
    comfortHeroes: normalizeHeroes(value?.comfortHeroes),
    heroPerformance: normalizeHeroPerformance(value?.heroPerformance),
  };
}

export async function getPlayerProfile() {
  return normalizeProfile(await cache.read<Partial<PlayerProfile>>(file, defaultProfile));
}

export async function savePlayerProfile(input: Partial<PlayerProfile>) {
  const current = await getPlayerProfile();
  const profile = normalizeProfile({ ...current, ...input });
  await cache.write(file, profile);
  return profile;
}
