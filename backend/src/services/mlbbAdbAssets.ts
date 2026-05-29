import { execFile } from "node:child_process";
import { access, copyFile, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { resolveAdb } from "./adbFrameSource.js";

const execFileAsync = promisify(execFile);
const packageId = "com.mobile.legends";
const assetRoot = `/sdcard/Android/data/${packageId}/files/dragon2017/assets`;
const uiRemoteRoot = `${assetRoot}/UI/android`;
const artRemoteRoot = `${assetRoot}/Art/android`;
const dataRoot = path.resolve(process.cwd(), "..", "data", "adb-assets");
const sourceDir = path.join(dataRoot, "bundles");
const uiLibraryDir = path.join(dataRoot, "library", "UI", "android");
const texturesDir = path.join(dataRoot, "textures");
const extractorDir = path.join(dataRoot, ".extractor");
const manifestPath = path.join(dataRoot, "manifest.json");
const catalogPath = path.join(dataRoot, "catalog.json");
const extractorScript = path.resolve(process.cwd(), "tools", "extractUnityTextures.py");
const draftUiPattern = /(ChooseHero|ChooseLane|BanList|Hero_Head|HeroIcon|SkillIcon|BattleLoading|BattleGround|MiniMap|HeadIcon|OneHeroIcon|HeadCutting|HeadPanel|HeadShow)/i;
const draftArtPattern = /(ChooseHero|ChooseLane|BattleLoading|HeroHead|HeroIcon|BPBan|MiniMap)/i;
const visionMatchers = {
  draft: /(ChooseHero|ChooseLane|BanList|Hero_Head|HeroIcon|SkillIcon|BPBan)/i,
  minimap: /(MiniMap|BattleGround|BattleMap)/i,
  hud: /(BattleInfo|HeadInfo|HeadPanel|BattleSetup|BattleMessage|BattleChat|BattlePickup)/i,
  objectives: /(Lord|Turtle|GoldenTurtle|Creep|Monster|Tower|Turret)/i,
  scoreboard: /(BattlePerformance|BattleData|BattleResult|Scoreboard|Statistics|Settlement)/i,
  builds: /(BattleShop|BattlePlan|RecEquip|PickupEquip|EquipIcon|Equipment)/i,
  loading: /(BattleLoading|ScenesLoading|GuideLoading)/i,
  status: /(BattlePlayback|DeathReplay|BattleDeath|Reconnect)/i,
  lobby: /(MatchRoom|ChooseMode|Matching|Ranking|RankMode)/i,
} as const;

type AssetScope = "draft" | "vision" | "ui";
type BundleCategory = "draft" | "hero" | "battle" | "map" | "ui-effect";
type VisionSurface = keyof typeof visionMatchers;
type AssetCandidate = {
  id: string;
  file: string;
  category: BundleCategory;
  source: "UI" | "Art";
  remote: string;
  relative: string;
  surfaces: VisionSurface[];
};
type SyncedBundle = AssetCandidate & {
  local: string;
  bytes: number;
};
type ExtractedTexture = {
  name: string;
  kind: string;
  file: string;
  width: number;
  height: number;
};
type ExtractedBundle = {
  bundle: string;
  objects: Record<string, number>;
  textures: ExtractedTexture[];
  error: string | null;
};
type AssetInventory = {
  discoveredAt: string;
  uiBundles: number;
  uiBytes: number;
  draftUiBundles: number;
  draftArtBundles: number;
  draftBundles: number;
  visionBundles: number;
  coverage: Array<{ surface: VisionSurface; uiBundles: number; artBundles: number; total: number }>;
  uiPaths: string[];
  draftUiPaths: string[];
  draftArtPaths: string[];
  visionCandidates: AssetCandidate[];
};

export type MlbbAdbAssetManifest = {
  packageId: string;
  versionName: string;
  device: string;
  assetRoot: string;
  scope: AssetScope;
  syncedAt: string;
  inventory: Omit<AssetInventory, "uiPaths" | "draftUiPaths" | "draftArtPaths" | "visionCandidates">;
  library: {
    uiComplete: boolean;
    uiDownloaded: number;
    uiBundles: number;
    local: string;
  };
  bundles: SyncedBundle[];
  extraction: {
    ready: boolean;
    textures: number;
    bundles: ExtractedBundle[];
  };
};

async function exists(file: string) {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

async function adbText(adb: string, args: string[], timeout = 10000) {
  const { stdout } = await execFileAsync(adb, args, { encoding: "utf8", timeout, windowsHide: true, maxBuffer: 16 * 1024 * 1024 });
  return String(stdout);
}

async function connectedDevice(adb: string) {
  const output = await adbText(adb, ["devices", "-l"]);
  const deviceLine = output.split(/\r?\n/).find((line) => /\sdevice\s/.test(line));
  if (!deviceLine) throw new Error("No authorized ADB device found.");
  return deviceLine.trim();
}

async function gameVersion(adb: string) {
  const output = await adbText(adb, ["shell", "dumpsys", "package", packageId], 20000);
  return output.match(/versionName=([^\s]+)/)?.[1] ?? "unknown";
}

function lines(value: string) {
  return value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

function categoryFor(file: string): BundleCategory {
  if (/choose|ban/i.test(file)) return "draft";
  if (/hero|head|skill/i.test(file)) return "hero";
  if (/battle|loading/i.test(file)) return "battle";
  if (/map/i.test(file)) return "map";
  return "ui-effect";
}

function relativeRemote(remote: string, root: string) {
  return remote.slice(root.length).replace(/^\/+/, "");
}

function matchingSurfaces(remote: string, source: "UI" | "Art"): VisionSurface[] {
  const file = path.posix.basename(remote);
  if (source === "Art" && !/(^|_)(FX_UI|UI_|ui_)/i.test(file)) return [];
  return (Object.entries(visionMatchers) as Array<[VisionSurface, RegExp]>)
    .filter(([, matcher]) => matcher.test(file))
    .map(([surface]) => surface);
}

function toCandidate(remote: string, source: "UI" | "Art", surfaces: VisionSurface[]): AssetCandidate {
  const relative = relativeRemote(remote, source === "UI" ? uiRemoteRoot : artRemoteRoot);
  return {
    id: `${source}/${relative}`,
    file: path.posix.basename(relative),
    category: categoryFor(relative),
    source,
    remote,
    relative: source === "UI" ? relative : `art/${relative}`,
    surfaces,
  };
}

async function discoverInventory(adb: string): Promise<AssetInventory> {
  const [uiOutput, artOutput, sizeOutput] = await Promise.all([
    adbText(adb, ["shell", "find", uiRemoteRoot, "-type", "f"], 60000),
    adbText(adb, ["shell", "find", artRemoteRoot, "-type", "f"], 120000),
    adbText(adb, ["shell", "du", "-sk", uiRemoteRoot], 60000),
  ]);
  const uiPaths = lines(uiOutput).filter((remote) => /\.unity3d$/i.test(remote));
  const artPaths = lines(artOutput).filter((remote) => /\.unity3d$/i.test(remote));
  const draftUiPaths = uiPaths.filter((remote) => draftUiPattern.test(path.posix.basename(remote)));
  const draftArtPaths = artPaths.filter((remote) => draftArtPattern.test(path.posix.basename(remote)));
  const visionUiCandidates = uiPaths
    .map((remote) => toCandidate(remote, "UI", matchingSurfaces(remote, "UI")))
    .filter((candidate) => candidate.surfaces.length > 0);
  const visionArtCandidates = artPaths
    .map((remote) => toCandidate(remote, "Art", matchingSurfaces(remote, "Art")))
    .filter((candidate) => candidate.surfaces.length > 0);
  const visionCandidates = [...visionUiCandidates, ...visionArtCandidates];
  const coverage = (Object.keys(visionMatchers) as VisionSurface[]).map((surface) => {
    const uiBundles = visionUiCandidates.filter((candidate) => candidate.surfaces.includes(surface)).length;
    const artBundles = visionArtCandidates.filter((candidate) => candidate.surfaces.includes(surface)).length;
    return { surface, uiBundles, artBundles, total: uiBundles + artBundles };
  });
  const uiKilobytes = Number(sizeOutput.match(/^\s*(\d+)/)?.[1] ?? 0);
  return {
    discoveredAt: new Date().toISOString(),
    uiBundles: uiPaths.length,
    uiBytes: uiKilobytes * 1024,
    draftUiBundles: draftUiPaths.length,
    draftArtBundles: draftArtPaths.length,
    draftBundles: draftUiPaths.length + draftArtPaths.length,
    visionBundles: visionCandidates.length,
    coverage,
    uiPaths,
    draftUiPaths,
    draftArtPaths,
    visionCandidates,
  };
}

function draftCandidates(inventory: AssetInventory) {
  const ui = inventory.draftUiPaths.map((remote) => toCandidate(remote, "UI", ["draft"]));
  const art = inventory.draftArtPaths.map((remote) => toCandidate(remote, "Art", ["draft"]));
  return [...ui, ...art];
}

async function pullCandidate(adb: string, target: AssetCandidate, force: boolean): Promise<SyncedBundle> {
  const local = path.join(sourceDir, ...target.relative.split("/"));
  await mkdir(path.dirname(local), { recursive: true });
  if (force || !(await exists(local))) {
    const uiLibrarySource = target.source === "UI" ? path.join(uiLibraryDir, ...target.relative.split("/")) : "";
    if (!force && uiLibrarySource && await exists(uiLibrarySource)) {
      await copyFile(uiLibrarySource, local);
    } else {
      await execFileAsync(adb, ["pull", target.remote, local], {
        encoding: "utf8",
        timeout: 60000,
        windowsHide: true,
        maxBuffer: 2 * 1024 * 1024,
      });
    }
  }
  return {
    ...target,
    local: path.relative(dataRoot, local).replaceAll("\\", "/"),
    bytes: (await stat(local)).size,
  };
}

async function mapConcurrent<T, R>(values: T[], concurrency: number, operation: (value: T) => Promise<R>) {
  const output = new Array<R>(values.length);
  let next = 0;
  async function worker() {
    while (next < values.length) {
      const index = next;
      next += 1;
      output[index] = await operation(values[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, () => worker()));
  return output;
}

async function countUnityBundles(folder: string): Promise<number> {
  if (!(await exists(folder))) return 0;
  let total = 0;
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    const absolute = path.join(folder, entry.name);
    if (entry.isDirectory()) total += await countUnityBundles(absolute);
    else if (/\.unity3d$/i.test(entry.name)) total += 1;
  }
  return total;
}

async function syncFullUiLibrary(adb: string, inventory: AssetInventory, force: boolean) {
  await mkdir(uiLibraryDir, { recursive: true });
  const alreadyDownloaded = force ? 0 : await countUnityBundles(uiLibraryDir);
  if (alreadyDownloaded === inventory.uiBundles) return alreadyDownloaded;
  if (!alreadyDownloaded || force) {
    await execFileAsync(adb, ["pull", `${uiRemoteRoot}/.`, uiLibraryDir], {
      encoding: "utf8",
      timeout: 30 * 60 * 1000,
      windowsHide: true,
      maxBuffer: 16 * 1024 * 1024,
    });
  } else {
    const needed: string[] = [];
    for (const remote of inventory.uiPaths) {
      if (!(await exists(path.join(uiLibraryDir, relativeRemote(remote, uiRemoteRoot))))) needed.push(remote);
    }
    await mapConcurrent(needed, 6, async (remote) => {
      const local = path.join(uiLibraryDir, relativeRemote(remote, uiRemoteRoot));
      await mkdir(path.dirname(local), { recursive: true });
      await execFileAsync(adb, ["pull", remote, local], { encoding: "utf8", timeout: 60000, windowsHide: true });
      return local;
    });
  }
  return countUnityBundles(uiLibraryDir);
}

function managedPythonPath() {
  return process.platform === "win32"
    ? path.join(extractorDir, "Scripts", "python.exe")
    : path.join(extractorDir, "bin", "python");
}

async function ensureExtractor() {
  const python = managedPythonPath();
  if (await exists(python)) return python;
  await mkdir(dataRoot, { recursive: true });
  await execFileAsync("python", ["-m", "venv", extractorDir], { timeout: 120000, windowsHide: true });
  await execFileAsync(python, ["-m", "pip", "install", "--disable-pip-version-check", "--quiet", "UnityPy"], {
    timeout: 180000,
    windowsHide: true,
    maxBuffer: 8 * 1024 * 1024,
  });
  return python;
}

async function extractTextures(): Promise<ExtractedBundle[]> {
  const python = await ensureExtractor();
  const { stdout } = await execFileAsync(python, [extractorScript, sourceDir, texturesDir], {
    encoding: "utf8",
    timeout: 10 * 60 * 1000,
    windowsHide: true,
    maxBuffer: 64 * 1024 * 1024,
  });
  const parsed = JSON.parse(String(stdout)) as { bundles?: ExtractedBundle[] };
  return parsed.bundles ?? [];
}

async function readManifest() {
  try {
    return JSON.parse(await readFile(manifestPath, "utf8")) as MlbbAdbAssetManifest;
  } catch {
    return null;
  }
}

export async function getMlbbAdbAssetStatus() {
  const adb = await resolveAdb();
  const manifest = await readManifest();
  try {
    const device = await connectedDevice(adb);
    const versionName = await gameVersion(adb);
    return {
      ok: true,
      adb,
      device,
      versionName,
      targetCount: manifest?.scope === "draft"
        ? manifest.inventory.draftBundles
        : manifest?.inventory?.visionBundles ?? manifest?.bundles.length ?? 0,
      manifest,
    };
  } catch (error) {
    return {
      ok: false,
      adb,
      device: "",
      versionName: "",
      targetCount: manifest?.scope === "draft"
        ? manifest.inventory.draftBundles
        : manifest?.inventory?.visionBundles ?? manifest?.bundles.length ?? 0,
      manifest,
      error: error instanceof Error ? error.message : "ADB device lookup failed.",
    };
  }
}

export async function syncMlbbAdbAssets(scope: AssetScope = "draft"): Promise<MlbbAdbAssetManifest> {
  const adb = await resolveAdb();
  const device = await connectedDevice(adb);
  const versionName = await gameVersion(adb);
  const previous = await readManifest();
  const force = Boolean(previous?.versionName && previous.versionName !== versionName);
  const inventory = await discoverInventory(adb);
  await mkdir(sourceDir, { recursive: true });
  await mkdir(texturesDir, { recursive: true });
  const selectedCandidates = scope === "draft" ? draftCandidates(inventory) : inventory.visionCandidates;
  const bundles = await mapConcurrent(selectedCandidates, 6, (candidate) => pullCandidate(adb, candidate, force));
  if (!bundles.length) throw new Error("MLBB CV asset bundles were not readable over ADB.");
  const uiDownloaded = scope === "ui"
    ? await syncFullUiLibrary(adb, inventory, force)
    : previous?.library?.uiDownloaded ?? await countUnityBundles(uiLibraryDir);
  const extractedBundles = await extractTextures();
  const summarizedInventory = {
    discoveredAt: inventory.discoveredAt,
    uiBundles: inventory.uiBundles,
    uiBytes: inventory.uiBytes,
    draftUiBundles: inventory.draftUiBundles,
    draftArtBundles: inventory.draftArtBundles,
    draftBundles: inventory.draftBundles,
    visionBundles: inventory.visionBundles,
    coverage: inventory.coverage,
  };
  const manifest: MlbbAdbAssetManifest = {
    packageId,
    versionName,
    device,
    assetRoot,
    scope,
    syncedAt: new Date().toISOString(),
    inventory: summarizedInventory,
    library: {
      uiComplete: uiDownloaded === inventory.uiBundles,
      uiDownloaded,
      uiBundles: inventory.uiBundles,
      local: "library/UI/android",
    },
    bundles,
    extraction: {
      ready: true,
      textures: extractedBundles.reduce((count, bundle) => count + bundle.textures.length, 0),
      bundles: extractedBundles,
    },
  };
  await writeFile(catalogPath, JSON.stringify(inventory, null, 2), "utf8");
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2), "utf8");
  return manifest;
}

export async function readMlbbAdbTexture(relativePath: string) {
  const cleanPath = relativePath.replaceAll("\\", "/");
  if (!/^[A-Za-z0-9._/-]+\.png$/.test(cleanPath) || cleanPath.includes("..")) return null;
  const resolved = path.resolve(texturesDir, cleanPath);
  if (!resolved.startsWith(path.resolve(texturesDir) + path.sep)) return null;
  try {
    return await readFile(resolved);
  } catch {
    return null;
  }
}

export async function readMlbbAdbHeroHead(heroId: number) {
  if (!Number.isInteger(heroId) || heroId < 0) return null;
  return readMlbbAdbTexture(`Atlas_Hero_Head/HeroHead${String(heroId).padStart(3, "0")}.png`);
}

export type MlbbAdbSkinHeadReference = {
  heroId: number;
  skinId: string;
  file: string;
  image: Buffer;
};

export async function readMlbbAdbSkinHeadReferences() {
  if (!(await exists(texturesDir))) return [] as MlbbAdbSkinHeadReference[];
  const references: MlbbAdbSkinHeadReference[] = [];
  const seen = new Set<string>();
  for (const bundle of await readdir(texturesDir, { withFileTypes: true })) {
    if (!bundle.isDirectory() || !/^Atlas_SkinHeadIcon/i.test(bundle.name)) continue;
    const spriteDir = path.join(texturesDir, bundle.name, "sprites");
    if (!(await exists(spriteDir))) continue;
    for (const entry of await readdir(spriteDir, { withFileTypes: true })) {
      if (!entry.isFile()) continue;
      const match = entry.name.match(/^SkinHead(\d+)_([A-Za-z0-9_-]+)\.png$/i);
      if (!match) continue;
      const heroId = Number(match[1]);
      const skinId = `SkinHead${match[1]}_${match[2]}`;
      if (!Number.isInteger(heroId) || seen.has(skinId.toLowerCase())) continue;
      seen.add(skinId.toLowerCase());
      const relative = `${bundle.name}/sprites/${entry.name}`;
      references.push({
        heroId,
        skinId,
        file: relative,
        image: await readFile(path.join(spriteDir, entry.name)),
      });
    }
  }
  return references.sort((left, right) => left.heroId - right.heroId || left.skinId.localeCompare(right.skinId));
}
