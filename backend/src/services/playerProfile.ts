import { cache } from "./cacheService.js";

export type DraftLane = "exp" | "jungle" | "mid" | "roam" | "gold";

export type PlayerProfile = {
  displayName: string;
  rankProfile: string;
  preferredLane: DraftLane;
  comfortHeroes: string[];
};

const file = "player-profile.json";
const defaultProfile: PlayerProfile = {
  displayName: "Rokas",
  rankProfile: "Mythic",
  preferredLane: "jungle",
  comfortHeroes: [],
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

function normalizeProfile(value: Partial<PlayerProfile> | null | undefined): PlayerProfile {
  return {
    displayName: String(value?.displayName ?? defaultProfile.displayName).trim() || defaultProfile.displayName,
    rankProfile: String(value?.rankProfile ?? defaultProfile.rankProfile).trim() || defaultProfile.rankProfile,
    preferredLane: normalizeLane(value?.preferredLane),
    comfortHeroes: normalizeHeroes(value?.comfortHeroes),
  };
}

export async function getPlayerProfile() {
  return normalizeProfile(await cache.read<Partial<PlayerProfile>>(file, defaultProfile));
}

export async function savePlayerProfile(input: Partial<PlayerProfile>) {
  const profile = normalizeProfile(input);
  await cache.write(file, profile);
  return profile;
}
