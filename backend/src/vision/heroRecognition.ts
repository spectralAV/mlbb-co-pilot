import { cache } from "../services/cacheService.js";

type HeroReference = {
  id: number;
  name: string;
  roles: string[];
  lanes: string[];
  iconUrl: string;
  portraitUrl?: string;
  variants: Array<{
    id: string;
    transform: "normal" | "mirror-x";
    useFor: string[];
  }>;
};

const useCases = [
  "draft-ban-icon",
  "draft-grid-icon",
  "scoreboard-row",
  "attribute-row",
  "minimap-icon"
];
const portraitUseCases = ["draft-pick-portrait", "loading-card-portrait", "scoreboard-portrait"];

export const heroRecognitionScenes = {
  draft_pick: {
    description: "Circular ban icons and portrait pick rails during draft.",
    iconVariants: ["normal", "mirror-x"],
    supportedNow: ["top-row ban icons", "confidence-gated pick rail portraits using official and compiled skin face references"],
    notes: ["The center grid contains candidates, not confirmed facts.", "Current base designs come from official MLBB assets; additional skin references come from the compiled Wiki catalogue."]
  },
  loading_screen: {
    description: "Top enemy cards and bottom ally cards before match load.",
    supportedNow: [],
    blockedUntilPortraitCatalog: ["skin-specific hero loading cards"],
    notes: ["Official current portraits and supplemental skin artwork are indexed, but loading-card recognition is not yet calibrated."]
  },
  equipment_panel: {
    description: "Equipment tab rows with hero portraits, spells, emblems, and items.",
    supportedNow: [],
    blockedUntilPortraitCatalog: ["scoreboard hero portrait rows"]
  },
  attributes_panel: {
    description: "Attributes tab rows with hero portraits and stat columns.",
    supportedNow: [],
    blockedUntilPortraitCatalog: ["attributes hero portrait rows"]
  },
  live_hud: {
    description: "Live top HUD and minimap markers.",
    iconVariants: ["normal", "mirror-x"],
    supportedNow: [],
    notes: ["Minimap recognition begins with team-color markers; hero identity requires stronger validation."]
  }
} as const;

export async function getHeroRecognitionManifest() {
  const heroes = await cache.read<any[]>("compiled-heroes.json", []);
  const fallback = heroes.length ? heroes : await cache.read<any[]>("heroes.json", []);
  const officialRuntime = await cache.read<any>("runtime.json", { heroes: [] });
  const officialPortraits = new Map<number, string>(
    (officialRuntime.heroes ?? []).map((hero: any) => [Number(hero.id), officialHeroPortraitUrl(hero)]),
  );
  const officialIcons = new Map<number, string>(
    (officialRuntime.heroes ?? []).map((hero: any) => [Number(hero.id), officialHeroIconUrl(hero)]),
  );
  const references = fallback
    .map((hero) => toHeroReference(hero, officialPortraits.get(Number(hero.id)), officialIcons.get(Number(hero.id))))
    .filter((hero): hero is HeroReference => Boolean(hero));
  const portraitCount = references.filter((hero) => Boolean(hero.portraitUrl)).length;
  return {
    version: "0.3",
    source: ["data/cache/compiled-heroes.json", "data/cache/runtime.json"],
    heroCount: references.length,
    assets: {
      icon: { available: true, field: "iconUrl", useFor: useCases },
      portrait: {
        available: portraitCount > 0,
        count: portraitCount,
        field: "portraitUrl",
        useFor: portraitUseCases,
      }
    },
    matching: {
      strategy: "surface-specific-template-match",
      requiredVariants: ["normal", "mirror-x"],
      preprocessing: ["surface-mask", "resize-to-model-input", "color-normalize"],
      validation: ["scene-slot-side", "team-color", "ban-slot-state"]
    },
    scenes: heroRecognitionScenes,
    heroes: references
  };
}

export async function getHeroRecognitionReference(heroId: number) {
  const manifest = await getHeroRecognitionManifest();
  return manifest.heroes.find((hero) => hero.id === heroId) ?? null;
}

function toHeroReference(hero: any, portraitUrl?: string, officialIconUrl?: string): HeroReference | null {
  const id = Number(hero?.id ?? hero?.hero_id ?? hero?.raw?.id ?? hero?.raw?.hero_id);
  const name = String(hero?.name ?? hero?.hero_name ?? hero?.raw?.hero_name ?? "").trim();
  const iconUrl = String(officialIconUrl || ((hero?.icon ?? hero?.icon_url ?? hero?.img_src ?? hero?.raw?.img_src) ?? "")).trim();
  if (!Number.isFinite(id) || !name || !iconUrl) return null;
  return {
    id,
    name,
    roles: normalizeList(hero?.roles ?? hero?.role ?? hero?.raw?.role),
    lanes: normalizeList(hero?.lanes ?? hero?.lane ?? hero?.raw?.lane),
    iconUrl,
    portraitUrl: portraitUrl || undefined,
    variants: [
      { id: `${id}:normal`, transform: "normal", useFor: useCases },
      { id: `${id}:mirror-x`, transform: "mirror-x", useFor: useCases }
    ]
  };
}

export function officialHeroPortraitUrl(hero: any) {
  return String(hero?.painting ?? hero?.data?.painting ?? hero?.portrait ?? hero?.icon ?? "").trim();
}

function officialHeroIconUrl(hero: any) {
  return String(hero?.head ?? hero?.data?.head ?? "").trim();
}

function normalizeList(value: unknown) {
  if (Array.isArray(value)) return value.map(String).map((item) => item.trim()).filter(Boolean);
  if (typeof value === "string") return value.split(",").map((item) => item.trim()).filter(Boolean);
  return [];
}
