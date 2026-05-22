const FALLBACK = "";

function slug(value: unknown) {
  return String(value ?? "")
    .trim()
    .replace(/['\u2019]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
}

function titleFile(value: unknown) {
  return String(value ?? "")
    .trim()
    .replace(/['\u2019]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
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
  const raw = typeof emblem === "string" ? emblem : e?.img_src ?? e?.image_path ?? e?.icon_url ?? e?.icon;
  if (raw) {
    if (/^https?:\/\//i.test(String(raw)) || String(raw).includes("/images/emblem/main/")) return resolveAssetPath(String(raw));
    const filename = String(raw).includes("/") ? String(raw).split("/").pop() : raw;
    return resolveAssetPath(`/images/emblem/main/${String(filename).endsWith(".png") ? filename : `${slug(filename)}.png`}`);
  }
  const name = e?.name ?? e?.emblem_name;
  return name ? mlbbNextImage(`/images/emblem/main/${slug(String(name).replace(/ emblem$/i, ""))}.png`) : FALLBACK;
}

export function resolveTalentIcon(talent: unknown): string {
  const t = talent as any;
  const raw = typeof talent === "string" ? talent : t?.icon_url ?? t?.image_path ?? t?.img_src ?? t?.icon;
  if (!raw) return FALLBACK;
  if (String(raw).includes("/")) return resolveAssetPath(raw);
  return mlbbNextImage(`/images/emblem/ability/${raw}`);
}

export function resolveSpellIcon(spell: unknown): string {
  const key = slug(spell);
  if (!key) return FALLBACK;
  const map: Record<string, string> = {
    flicker: "Flicker.png",
    retribution: "Retribution.png",
    ice_retribution: "Retribution.png",
    flame_retribution: "Retribution.png",
    bloody_retribution: "Retribution.png",
    inspire: "Inspire.png",
    flameshot: "Flameshot.png",
    vengeance: "Vengeance.png",
    petrify: "Petrify.png",
    execute: "Execute.png",
    sprint: "Sprint.png",
    purify: "Purify.png",
    aegis: "Aegis.png",
    arrival: "Arrival.png",
    revitalize: "Revitalize.png",
    revitalise: "Revitalize.png",
    healing_spell: "Healing Spell.png"
  };
  return `https://mlbb.io/battle_spells/${encodeURIComponent(map[key] ?? `${titleFile(spell)}.png`)}`;
}
