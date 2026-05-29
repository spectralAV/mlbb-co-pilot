import fs from "node:fs/promises";
import path from "node:path";

export type OverlayMediaSlotId = "logo" | "sponsor";

export type ChromaKeyConfig = {
  enabled: boolean;
  color: string;
  tolerance: number;
  softness: number;
};

export type OverlayMediaSlot = {
  enabled: boolean;
  fileName: string;
  mediaType: "video" | "image" | "";
  mimeType: string;
  chromaKey: ChromaKeyConfig;
};

export type OverlayMediaConfig = {
  bandEnabled: boolean;
  bandOpacity: number;
  logo: OverlayMediaSlot;
  sponsor: OverlayMediaSlot;
  updatedAt: string;
};

const ROOT = path.resolve(process.cwd(), "..");
const MEDIA_DIR = path.join(ROOT, "data", "overlay-media");
const CONFIG_FILE = path.join(MEDIA_DIR, "config.json");
const MEDIA_EXTENSIONS = new Map([
  [".mp4", { mediaType: "video" as const, mimeType: "video/mp4" }],
  [".webm", { mediaType: "video" as const, mimeType: "video/webm" }],
  [".png", { mediaType: "image" as const, mimeType: "image/png" }],
  [".webp", { mediaType: "image" as const, mimeType: "image/webp" }],
]);

function defaultSlot(): OverlayMediaSlot {
  return {
    enabled: true,
    fileName: "",
    mediaType: "",
    mimeType: "",
    chromaKey: {
      enabled: false,
      color: "#00ff00",
      tolerance: 78,
      softness: 30,
    },
  };
}

function defaultConfig(): OverlayMediaConfig {
  return {
    bandEnabled: true,
    bandOpacity: 0.93,
    logo: defaultSlot(),
    sponsor: defaultSlot(),
    updatedAt: new Date().toISOString(),
  };
}

async function ensureMediaDir() {
  await fs.mkdir(MEDIA_DIR, { recursive: true });
}

function clamp(value: unknown, minimum: number, maximum: number, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(maximum, Math.max(minimum, parsed)) : fallback;
}

function normalizeKey(value: any, current: ChromaKeyConfig): ChromaKeyConfig {
  return {
    enabled: Boolean(value?.enabled ?? current.enabled),
    color: /^#[0-9a-f]{6}$/i.test(String(value?.color ?? "")) ? String(value.color) : current.color,
    tolerance: clamp(value?.tolerance, 0, 255, current.tolerance),
    softness: clamp(value?.softness, 0, 120, current.softness),
  };
}

function applySlotSettings(current: OverlayMediaSlot, incoming: any): OverlayMediaSlot {
  return {
    ...current,
    enabled: Boolean(incoming?.enabled ?? current.enabled),
    chromaKey: normalizeKey(incoming?.chromaKey, current.chromaKey),
  };
}

async function readStoredConfig(): Promise<OverlayMediaConfig> {
  await ensureMediaDir();
  try {
    const saved = JSON.parse(await fs.readFile(CONFIG_FILE, "utf8")) as Partial<OverlayMediaConfig>;
    const defaults = defaultConfig();
    return {
      ...defaults,
      ...saved,
      bandEnabled: Boolean(saved.bandEnabled ?? defaults.bandEnabled),
      bandOpacity: clamp(saved.bandOpacity, 0, 1, defaults.bandOpacity),
      logo: { ...defaults.logo, ...(saved.logo ?? {}), chromaKey: normalizeKey(saved.logo?.chromaKey, defaults.logo.chromaKey) },
      sponsor: { ...defaults.sponsor, ...(saved.sponsor ?? {}), chromaKey: normalizeKey(saved.sponsor?.chromaKey, defaults.sponsor.chromaKey) },
    };
  } catch {
    return defaultConfig();
  }
}

async function writeConfig(config: OverlayMediaConfig) {
  await ensureMediaDir();
  await fs.writeFile(CONFIG_FILE, JSON.stringify(config, null, 2), "utf8");
  return config;
}

export async function getOverlayMediaConfig() {
  return readStoredConfig();
}

export async function updateOverlayMediaConfig(next: any) {
  const current = await readStoredConfig();
  return writeConfig({
    ...current,
    bandEnabled: Boolean(next?.bandEnabled ?? current.bandEnabled),
    bandOpacity: clamp(next?.bandOpacity, 0, 1, current.bandOpacity),
    logo: applySlotSettings(current.logo, next?.logo),
    sponsor: applySlotSettings(current.sponsor, next?.sponsor),
    updatedAt: new Date().toISOString(),
  });
}

export async function saveOverlayMedia(slotId: OverlayMediaSlotId, originalName: string, data: Buffer) {
  const extension = path.extname(originalName).toLowerCase();
  const type = MEDIA_EXTENSIONS.get(extension);
  if (!type) throw new Error("Use an MP4, WebM, PNG, or WebP media file.");
  await ensureMediaDir();
  const current = await readStoredConfig();
  const storedName = `${slotId}${extension}`;
  const previousName = current[slotId].fileName;
  await fs.writeFile(path.join(MEDIA_DIR, storedName), data);
  if (previousName && previousName !== storedName) {
    await fs.rm(path.join(MEDIA_DIR, previousName), { force: true });
  }
  return writeConfig({
    ...current,
    [slotId]: {
      ...current[slotId],
      enabled: true,
      fileName: storedName,
      mediaType: type.mediaType,
      mimeType: type.mimeType,
    },
    updatedAt: new Date().toISOString(),
  });
}

export async function deleteOverlayMedia(slotId: OverlayMediaSlotId) {
  const current = await readStoredConfig();
  if (current[slotId].fileName) {
    await fs.rm(path.join(MEDIA_DIR, current[slotId].fileName), { force: true });
  }
  return writeConfig({
    ...current,
    [slotId]: { ...defaultSlot(), chromaKey: current[slotId].chromaKey },
    updatedAt: new Date().toISOString(),
  });
}

export async function readOverlayMedia(slotId: OverlayMediaSlotId) {
  const config = await readStoredConfig();
  const slot = config[slotId];
  if (!slot.fileName) return null;
  try {
    return { data: await fs.readFile(path.join(MEDIA_DIR, slot.fileName)), mimeType: slot.mimeType };
  } catch {
    return null;
  }
}
