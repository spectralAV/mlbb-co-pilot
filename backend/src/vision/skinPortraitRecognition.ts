import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { cache } from "../services/cacheService.js";
import { officialHeroPortraitUrl } from "./heroRecognition.js";

const SOURCE_WIKI = "https://mobile-legends.fandom.com/wiki/";
const SOURCE_API = "https://mobile-legends.fandom.com/api.php";
const PORTRAIT_PROVENANCE = "Current base hero designs use official Mobile Legends art; additional skin portraits and face thumbnails are indexed from the community-maintained Mobile Legends Wiki.";

type SkinPortrait = {
  id: string;
  name: string;
  fileName: string;
  imageUrl: string;
  iconUrl?: string;
  source: "official" | "wiki";
};
type SkinHero = {
  heroId: number;
  heroName: string;
  sourcePage: string;
  portraits: SkinPortrait[];
};
type SkinManifest = {
  version: string;
  source: string;
  provenance: string;
  syncedAt: string;
  heroes: SkinHero[];
  portraitCount: number;
};
type SkinSignatureReference = {
  heroId: number;
  heroName: string;
  skinId: string;
  skinName: string;
  asset?: "icon" | "portrait";
  variant: "normal" | "mirror-x";
  signature: number[];
};
type SkinSignatureManifest = {
  version: string;
  source: string;
  compiledAt: string;
  portraitCount: number;
  referenceCount: number;
  references: SkinSignatureReference[];
};

export async function getSkinPortraitManifest() {
  const manifest = await cache.read<SkinManifest>("skin-portrait-references.json", {
    version: "0.2",
    source: SOURCE_WIKI,
    provenance: PORTRAIT_PROVENANCE,
    syncedAt: "",
    heroes: [],
    portraitCount: 0,
  });
  return mergeOfficialCurrentPortraits(manifest);
}

export async function syncSkinPortraitManifest() {
  const heroes = await cache.read<any[]>("compiled-heroes.json", []);
  const details = await mapLimit(heroes, 8, async (hero) => fetchHeroSkins(Number(hero.id), String(hero.name)));
  const populated = details.filter((hero): hero is SkinHero => Boolean(hero?.portraits.length));
  const manifest = await mergeOfficialCurrentPortraits({
    version: "0.2",
    source: SOURCE_WIKI,
    provenance: PORTRAIT_PROVENANCE,
    syncedAt: new Date().toISOString(),
    heroes: populated.sort((left, right) => left.heroName.localeCompare(right.heroName)),
    portraitCount: populated.reduce((count, hero) => count + hero.portraits.length, 0),
  });
  await cache.write("skin-portrait-references.json", manifest);
  return manifest;
}

export async function getSkinSignatureManifest() {
  return cache.read<SkinSignatureManifest>("skin-portrait-signatures.json", {
    version: "0.1",
    source: SOURCE_WIKI,
    compiledAt: "",
    portraitCount: 0,
    referenceCount: 0,
    references: [],
  });
}

export async function compileSkinPortraitSignatures() {
  const manifest = await getSkinPortraitManifest();
  const sourcePortraits = manifest.heroes.flatMap((hero) =>
    hero.portraits.map((portrait) => ({ hero, portrait })),
  );
  const groups = await mapLimit(sourcePortraits, 8, async ({ hero, portrait }) => {
    const portraitImage = await fetchSkinPortrait(hero.heroId, portrait.id);
    if (!portraitImage) return [];
    const metadata = await sharp(portraitImage.data).metadata();
    const width = metadata.width ?? 0;
    const height = metadata.height ?? 0;
    if (!width || !height) return [];
    const references: SkinSignatureReference[] = [];
    if (portrait.iconUrl) {
      const icon = await fetchCachedImage(portrait.iconUrl, `skin-icons/${hero.heroId}-${safePathPart(portrait.id)}.png`);
      if (icon) {
        const { data, info } = await sharp(icon.data)
          .resize(64, 64)
          .ensureAlpha()
          .raw()
          .toBuffer({ resolveWithObject: true });
        references.push({
          heroId: hero.heroId,
          heroName: hero.heroName,
          skinId: portrait.id,
          skinName: portrait.name,
          asset: "icon",
          variant: "normal",
          signature: iconSignatureFromRgba(data, info.width, info.height, 8),
        });
      }
    }
    const side = Math.min(width, height);
    const travel = Math.max(0, height - side);
    for (const anchor of [0, 0.18, 0.36, 0.54]) {
      const top = Math.round(travel * anchor);
      const { data, info } = await sharp(portraitImage.data)
        .extract({ left: 0, top, width: side, height: side })
        .resize(64, 64)
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      references.push({
        heroId: hero.heroId,
        heroName: hero.heroName,
        skinId: portrait.id,
        skinName: portrait.name,
        asset: "portrait",
        variant: "normal",
        signature: portraitSignatureFromRgba(data, info.width, info.height),
      });
    }
    return references;
  });
  const references = groups.flat();
  const compiled: SkinSignatureManifest = {
    version: "0.1",
    source: manifest.source,
    compiledAt: new Date().toISOString(),
    portraitCount: sourcePortraits.length,
    referenceCount: references.length,
    references,
  };
  await cache.write("skin-portrait-signatures.json", compiled);
  return compiled;
}

export async function getSkinSignatureStatus() {
  const compiled = await getSkinSignatureManifest();
  return {
    version: compiled.version,
    source: compiled.source,
    compiledAt: compiled.compiledAt,
    portraitCount: compiled.portraitCount,
    referenceCount: compiled.referenceCount,
  };
}

export async function fetchSkinPortrait(heroId: number, skinId: string) {
  const manifest = await getSkinPortraitManifest();
  const reference = manifest.heroes
    .find((hero) => hero.heroId === heroId)
    ?.portraits.find((portrait) => portrait.id === skinId);
  if (!reference) return null;
  const localPath = path.join(cache.dir, "skin-portraits", `${heroId}-${safePathPart(skinId)}.png`);
  try {
    return { data: await readFile(localPath), contentType: "image/png" };
  } catch {
    // First request populates the local catalogue image cache.
  }
  const image = await fetch(reference.imageUrl, { headers: { "user-agent": "MLBB-Co-Pilot/0.4" } });
  if (!image.ok) return null;
  const data = Buffer.from(await image.arrayBuffer());
  await mkdir(path.dirname(localPath), { recursive: true });
  await writeFile(localPath, data);
  return { data, contentType: image.headers.get("content-type") ?? "image/png" };
}

async function fetchCachedImage(url: string, relativePath: string) {
  const localPath = path.join(cache.dir, relativePath);
  try {
    return { data: await readFile(localPath), contentType: "image/png" };
  } catch {
    // First compile downloads and stores the detector reference image.
  }
  const image = await fetch(url, { headers: { "user-agent": "MLBB-Co-Pilot/0.4" } });
  if (!image.ok) return null;
  const data = Buffer.from(await image.arrayBuffer());
  await mkdir(path.dirname(localPath), { recursive: true });
  await writeFile(localPath, data);
  return { data, contentType: image.headers.get("content-type") ?? "image/png" };
}

async function fetchHeroSkins(heroId: number, heroName: string): Promise<SkinHero | null> {
  const page = `${heroName}/Cosmetics`;
  const url = new URL(SOURCE_API);
  url.searchParams.set("action", "parse");
  url.searchParams.set("page", page);
  url.searchParams.set("prop", "text");
  url.searchParams.set("format", "json");
  url.searchParams.set("origin", "*");
  const response = await fetch(url, { headers: { "user-agent": "MLBB-Co-Pilot/0.4" } });
  if (!response.ok) return null;
  const body = await response.json() as { parse?: { text?: { "*": string } } };
  const html = body.parse?.text?.["*"] ?? "";
  const portraits = await attachWikiIconUrls(parseSkinPortraits(html));
  if (!portraits.length) return null;
  return {
    heroId,
    heroName,
    sourcePage: `${SOURCE_WIKI}${encodeURIComponent(heroName)}/Cosmetics`,
    portraits,
  };
}

export function parseSkinPortraits(html: string) {
  const portraits: SkinPortrait[] = [];
  const seen = new Set<string>();
  const boxPattern = /<div class="skin-box"[\s\S]*?(?=<div class="skin-box"|<h2|$)/g;
  for (const match of html.matchAll(boxPattern)) {
    const block = match[0];
    const fileMatch = block.match(/data-image-name="([^"]+-portrait\.png)"/)
      ?? block.match(/alt="([^"]+-portrait)"/);
    const fileName = fileMatch?.[1]?.endsWith(".png") ? fileMatch[1] : fileMatch?.[1] ? `${fileMatch[1]}.png` : undefined;
    const imageUrl = block.match(/(?:data-src|src)="(https:\/\/static\.wikia[^"]+-portrait\.png\/revision\/latest[^"]*)"/)?.[1];
    const skinName = block.match(/<div class="skin-box-name"[\s\S]*?<span[^>]*>([^<]+)<\/span>/)?.[1];
    if (!fileName || !imageUrl || !skinName) continue;
    if (seen.has(fileName)) continue;
    seen.add(fileName);
    portraits.push({
      id: fileName.replace(/\.png$/i, ""),
      name: decodeHtml(skinName.trim()),
      fileName,
      imageUrl: decodeHtml(imageUrl).replace(/\/scale-to-width-down\/\d+(?=\?)/, ""),
      source: "wiki",
    });
  }
  return portraits;
}

async function attachWikiIconUrls(portraits: SkinPortrait[]) {
  if (!portraits.length) return portraits;
  const url = new URL(SOURCE_API);
  url.searchParams.set("action", "query");
  url.searchParams.set(
    "titles",
    portraits.map((portrait) => `File:${portrait.fileName.replace("-portrait.png", "-icon.png")}`).join("|"),
  );
  url.searchParams.set("prop", "imageinfo");
  url.searchParams.set("iiprop", "url");
  url.searchParams.set("format", "json");
  url.searchParams.set("origin", "*");
  const response = await fetch(url, { headers: { "user-agent": "MLBB-Co-Pilot/0.4" } });
  if (!response.ok) return portraits;
  const body = await response.json() as {
    query?: { pages?: Record<string, { title?: string; imageinfo?: Array<{ url?: string }> }> };
  };
  const icons = new Map(
    Object.values(body.query?.pages ?? {})
      .filter((page) => page.title && page.imageinfo?.[0]?.url)
      .map((page) => [String(page.title).replace(/^File:/, "").replace("-icon.png", "-portrait.png"), page.imageinfo![0].url!]),
  );
  return portraits.map((portrait) => ({ ...portrait, iconUrl: icons.get(portrait.fileName) }));
}

async function mergeOfficialCurrentPortraits(manifest: SkinManifest) {
  const runtime = await cache.read<any>("runtime.json", { heroes: [] });
  const currentPortraits = new Map<number, string>(
    (runtime.heroes ?? []).map((hero: any) => [
      Number(hero.id),
      officialHeroPortraitUrl(hero),
    ]),
  );
  const currentIcons = new Map<number, string>(
    (runtime.heroes ?? []).map((hero: any) => [Number(hero.id), String(hero.head ?? "").trim()]),
  );
  const heroes = manifest.heroes.map((hero) => {
    const official = currentPortraits.get(hero.heroId);
    if (!official || !hero.portraits.length) return hero;
    const [base, ...skins] = hero.portraits;
    if (base.source === "official") return hero;
    return {
      ...hero,
      portraits: [{
        ...base,
        id: `official-${hero.heroId}`,
        fileName: `official-${hero.heroId}`,
        imageUrl: official,
        iconUrl: currentIcons.get(hero.heroId) || undefined,
        source: "official" as const,
      }, {
        ...base,
        name: `${base.name} (Classic)`,
      }, ...skins],
    };
  });
  return {
    ...manifest,
    provenance: PORTRAIT_PROVENANCE,
    heroes,
    portraitCount: heroes.reduce((count, hero) => count + hero.portraits.length, 0),
  };
}

function decodeHtml(value: string) {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&#39;", "'")
    .replaceAll("&#x27;", "'")
    .replaceAll("&quot;", "\"");
}

function safePathPart(value: string) {
  return value.replace(/[^a-z0-9_-]/gi, "_");
}

function portraitSignatureFromRgba(rgba: Uint8Array, width: number, height: number, columns = 6, rows = 8) {
  const output: number[] = [];
  for (let gy = 0; gy < rows; gy += 1) {
    for (let gx = 0; gx < columns; gx += 1) {
      let red = 0;
      let green = 0;
      let blue = 0;
      let count = 0;
      const startX = Math.floor((gx / columns) * width);
      const endX = Math.max(startX + 1, Math.floor(((gx + 1) / columns) * width));
      const startY = Math.floor((gy / rows) * height);
      const endY = Math.max(startY + 1, Math.floor(((gy + 1) / rows) * height));
      for (let y = startY; y < Math.min(height, endY); y += 1) {
        for (let x = startX; x < Math.min(width, endX); x += 1) {
          const nx = (x + 0.5) / width;
          const ny = (y + 0.5) / height;
          if (nx < 0.14 || nx > 0.86 || ny < 0.08 || ny > 0.82) continue;
          const index = (y * width + x) * 4;
          if (rgba[index + 3] < 24) continue;
          red += rgba[index];
          green += rgba[index + 1];
          blue += rgba[index + 2];
          count += 1;
        }
      }
      output.push(roundSignature(count ? red / count / 255 : 0));
      output.push(roundSignature(count ? green / count / 255 : 0));
      output.push(roundSignature(count ? blue / count / 255 : 0));
    }
  }
  return output;
}

function iconSignatureFromRgba(rgba: Uint8Array, width: number, height: number, gridSize = 16) {
  const output: number[] = [];
  for (let gy = 0; gy < gridSize; gy += 1) {
    for (let gx = 0; gx < gridSize; gx += 1) {
      let red = 0;
      let green = 0;
      let blue = 0;
      let count = 0;
      const startX = Math.floor((gx / gridSize) * width);
      const endX = Math.max(startX + 1, Math.floor(((gx + 1) / gridSize) * width));
      const startY = Math.floor((gy / gridSize) * height);
      const endY = Math.max(startY + 1, Math.floor(((gy + 1) / gridSize) * height));
      for (let y = startY; y < Math.min(height, endY); y += 1) {
        for (let x = startX; x < Math.min(width, endX); x += 1) {
          const dx = (x + 0.5) / width - 0.5;
          const dy = (y + 0.5) / height - 0.5;
          if (dx * dx + dy * dy > 0.245) continue;
          if ((dx - 0.27) ** 2 + (dy - 0.24) ** 2 < 0.045) continue;
          const index = (y * width + x) * 4;
          if (rgba[index + 3] < 24) continue;
          red += rgba[index];
          green += rgba[index + 1];
          blue += rgba[index + 2];
          count += 1;
        }
      }
      output.push(roundSignature(count ? red / count / 255 : 0));
      output.push(roundSignature(count ? green / count / 255 : 0));
      output.push(roundSignature(count ? blue / count / 255 : 0));
    }
  }
  return output;
}

function roundSignature(value: number) {
  return Math.round(value * 10000) / 10000;
}

async function mapLimit<T, R>(items: T[], limit: number, work: (item: T) => Promise<R>) {
  const output: R[] = [];
  let index = 0;
  async function worker() {
    while (index < items.length) {
      const item = items[index++];
      output.push(await work(item));
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return output;
}
