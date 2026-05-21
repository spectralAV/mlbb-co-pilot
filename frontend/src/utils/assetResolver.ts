const FALLBACK = "";

function slug(value: unknown) {
  return String(value ?? "")
    .trim()
    .replace(/['’]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
}

function mlbbNextImage(path: string, size = 64) {
  return `https://mlbb.io/_next/image?url=${encodeURIComponent(path)}&w=${size}&q=75`;
}

export function resolveAssetPath(path?: string | null, fallback = FALLBACK): string {
  if (!path) return fallback;
  if (/^https?:\/\//i.test(path)) return path;
  const normalized = path.startsWith("/") ? path : `/${path}`;
  if (normalized.includes("/images/")) return mlbbNextImage(normalized);
  return `https://mlbb.io${normalized}`;
}

export function resolveHeroIcon(hero: unknown): string {
  const h = hero as any;
  return resolveAssetPath(h?.icon_url ?? h?.img_src ?? h?.image_path ?? h?.avatar ?? h?.icon ?? h?.hero?.img_src ?? h?.hero?.image_path);
}

export function resolveItemIcon(item: unknown): string {
  const i = item as any;
  return resolveAssetPath(i?.icon_url ?? i?.image_path ?? i?.img_src);
}

export function resolveEmblemIcon(emblem: unknown): string {
  const e = emblem as any;
  const raw = typeof emblem === "string" ? emblem : e?.img_src ?? e?.image_path ?? e?.icon_url;
  if (raw) return resolveAssetPath(String(raw).endsWith(".png") || String(raw).includes("/") ? String(raw) : `/images/emblems/${slug(raw)}.png`);
  const name = e?.name ?? e?.emblem_name;
  return name ? mlbbNextImage(`/images/emblems/${slug(String(name).replace(/ emblem$/i, ""))}.png`) : FALLBACK;
}

export function resolveTalentIcon(talent: unknown): string {
  const t = talent as any;
  const raw = t?.icon_url ?? t?.image_path ?? t?.img_src;
  if (!raw) return FALLBACK;
  return String(raw).includes("/") ? resolveAssetPath(raw) : mlbbNextImage(`/images/emblems/abilities/${raw}`);
}

export function resolveSpellIcon(spell: unknown): string {
  const key = slug(spell);
  if (!key) return FALLBACK;
  const map: Record<string, string> = {
    flicker: "flicker.png",
    retribution: "retribution.png",
    inspire: "inspire.png",
    flameshot: "flameshot.png",
    vengeance: "vengeance.png",
    petrify: "petrify.png",
    execute: "execute.png",
    sprint: "sprint.png",
    purify: "purify.png",
    aegis: "aegis.png",
    arrival: "arrival.png",
    revitalize: "revitalize.png",
    revitalise: "revitalize.png",
    healing_spell: "healing_spell.png"
  };
  return mlbbNextImage(`/images/spells/${map[key] ?? `${key}.png`}`);
}
