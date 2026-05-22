import { cache } from "../services/cacheService.js";

type HeroReference = {
  id: number;
  name: string;
  roles: string[];
  lanes: string[];
  iconUrl: string;
  variants: Array<{
    id: string;
    transform: "normal" | "mirror-x";
    useFor: string[];
  }>;
};

const useCases = [
  "draft-grid",
  "draft-slot",
  "loading-card",
  "scoreboard-row",
  "attribute-row",
  "minimap-portrait"
];

export const heroRecognitionScenes = {
  draft_pick: {
    description: "Hero grid and pick slots during draft.",
    portraitVariants: ["normal", "mirror-x"],
    notes: ["Enemy-side pick slots may be horizontally mirrored."]
  },
  loading_screen: {
    description: "Top enemy cards and bottom ally cards before match load.",
    portraitVariants: ["normal", "mirror-x"],
    notes: ["Card art can be skin-specific, so use hero icon match as a fallback when card art differs."]
  },
  equipment_panel: {
    description: "Equipment tab rows with hero portraits, spells, emblems, and items.",
    portraitVariants: ["normal", "mirror-x"],
    notes: ["Rows are stable; match portrait first, then validate with nearby OCR hero name when available."]
  },
  attributes_panel: {
    description: "Attributes tab rows with hero portraits and stat columns.",
    portraitVariants: ["normal", "mirror-x"],
    notes: ["Same row anchors as equipment panel, different table schema."]
  },
  live_hud: {
    description: "Live top HUD and minimap portrait markers.",
    portraitVariants: ["normal", "mirror-x"],
    notes: ["Minimap portraits are tiny; use color/team marker plus projected position as extra confidence."]
  }
} as const;

export async function getHeroRecognitionManifest() {
  const heroes = await cache.read<any[]>("compiled-heroes.json", []);
  const fallback = heroes.length ? heroes : await cache.read<any[]>("heroes.json", []);
  const references = fallback.map(toHeroReference).filter((hero): hero is HeroReference => Boolean(hero));
  return {
    version: "0.1",
    source: "data/cache/compiled-heroes.json",
    heroCount: references.length,
    matching: {
      strategy: "reference-embedding-and-template-match",
      requiredVariants: ["normal", "mirror-x"],
      preprocessing: ["circle-mask", "center-crop", "resize-to-model-input", "color-normalize"],
      validation: ["scene-slot-side", "nearby-name-ocr", "team-color", "draft-slot-state"]
    },
    scenes: heroRecognitionScenes,
    heroes: references
  };
}

function toHeroReference(hero: any): HeroReference | null {
  const id = Number(hero?.id ?? hero?.hero_id ?? hero?.raw?.id ?? hero?.raw?.hero_id);
  const name = String(hero?.name ?? hero?.hero_name ?? hero?.raw?.hero_name ?? "").trim();
  const iconUrl = String(hero?.icon ?? hero?.icon_url ?? hero?.img_src ?? hero?.raw?.img_src ?? "").trim();
  if (!Number.isFinite(id) || !name || !iconUrl) return null;
  return {
    id,
    name,
    roles: normalizeList(hero?.roles ?? hero?.role ?? hero?.raw?.role),
    lanes: normalizeList(hero?.lanes ?? hero?.lane ?? hero?.raw?.lane),
    iconUrl,
    variants: [
      { id: `${id}:normal`, transform: "normal", useFor: useCases },
      { id: `${id}:mirror-x`, transform: "mirror-x", useFor: useCases }
    ]
  };
}

function normalizeList(value: unknown) {
  if (Array.isArray(value)) return value.map(String).map((item) => item.trim()).filter(Boolean);
  if (typeof value === "string") return value.split(",").map((item) => item.trim()).filter(Boolean);
  return [];
}
