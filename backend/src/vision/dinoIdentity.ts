import { execFile } from "node:child_process";
import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { nanoid } from "nanoid";
import sharp from "sharp";
import { readMlbbAdbHeroHead } from "../services/mlbbAdbAssets.js";
import { annotationImage, listAnnotations } from "./cvAnnotation.js";
import { getHeroRecognitionManifest } from "./heroRecognition.js";

const execFileAsync = promisify(execFile);
const projectRoot = path.resolve(process.cwd(), "..");
const identityRoot = path.join(projectRoot, "data", "cv", "identity");
const referencesRoot = path.join(identityRoot, "references");
const manifestPath = path.join(identityRoot, "reference-manifest.json");
const indexPath = path.join(identityRoot, "dinov2-index.json");
const managedPython = path.join(projectRoot, "data", "cv", ".venv", "Scripts", "python.exe");
const script = path.join(projectRoot, "backend", "tools", "dinoIdentity.py");

export type DinoSurface = "draft" | "live_minimap";
type DinoReference = {
  id: string;
  surface: DinoSurface;
  heroId: number;
  heroName: string;
  variant: "normal" | "mirror-x";
  source: "installed-draft-head" | "cv-lab-minimap";
  image: string;
};
type DinoManifest = {
  model: "dinov2_vits14";
  compiledAt: string;
  references: DinoReference[];
};
type DinoIndexHeader = {
  indexedAt?: string;
};

export async function getDinoIdentityStatus() {
  const manifest = await readJson<DinoManifest | null>(manifestPath, null);
  const index = await readJson<DinoIndexHeader | null>(indexPath, null);
  const indexed = Boolean(manifest?.compiledAt && index?.indexedAt === manifest.compiledAt);
  const toolStatus = await runDino(["status"]).catch(() => ({
    engine: "dinov2-reference-matching",
    model: "dinov2_vits14",
    torchAvailable: false,
  }));
  const references = manifest?.references ?? [];
  return {
    ...toolStatus,
    indexed,
    compiledAt: manifest?.compiledAt ?? null,
    references: {
      draft: references.filter((reference) => reference.surface === "draft").length,
      liveMinimap: references.filter((reference) => reference.surface === "live_minimap").length,
      heroes: new Set(references.map((reference) => reference.heroId)).size,
    },
  };
}

export async function compileDinoReferenceBank() {
  await mkdir(identityRoot, { recursive: true });
  await Promise.all([
    rm(path.join(referencesRoot, "draft"), { recursive: true, force: true }),
    rm(path.join(referencesRoot, "live_minimap"), { recursive: true, force: true }),
  ]);
  const references: DinoReference[] = [];
  const heroManifest = await getHeroRecognitionManifest();
  for (const hero of heroManifest.heroes) {
    const image = await readMlbbAdbHeroHead(Number(hero.id));
    if (!image) continue;
    references.push(...await saveVariants(image, "draft", Number(hero.id), String(hero.name), "installed-draft-head", `hero-${hero.id}`));
  }
  for (const sample of await listAnnotations()) {
    const imageFile = await annotationImage(sample.id);
    if (!imageFile) continue;
    for (const [index, box] of sample.boxes.entries()) {
      if (!box.heroId || !box.heroName || !["ally_hero_marker", "enemy_hero_marker"].includes(box.className)) continue;
      const metadata = await sharp(imageFile).metadata();
      const width = metadata.width ?? 0;
      const height = metadata.height ?? 0;
      if (!width || !height) continue;
      const crop = await sharp(imageFile)
        .extract(toCrop(box.rect, width, height))
        .png()
        .toBuffer();
      references.push(...await saveVariants(crop, "live_minimap", box.heroId, box.heroName, "cv-lab-minimap", `${sample.id}-${index}`));
    }
  }
  const manifest: DinoManifest = {
    model: "dinov2_vits14",
    compiledAt: new Date().toISOString(),
    references,
  };
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return manifest;
}

export async function indexDinoReferences() {
  const manifest = await compileDinoReferenceBank();
  if (!manifest.references.length) throw new Error("No DINO identity references are available.");
  await runDino(["index", "--manifest", manifestPath, "--output", indexPath], 30 * 60 * 1000);
  return getDinoIdentityStatus();
}

export async function matchDinoIdentity(
  image: Buffer,
  options: { surface?: unknown; heroIds?: unknown; minimumConfidence?: unknown; minimumMargin?: unknown } = {},
) {
  if (!(await getDinoIdentityStatus()).indexed) throw new Error("Build the current DINO identity index before matching crops.");
  const surface: DinoSurface = options.surface === "live_minimap" ? "live_minimap" : "draft";
  const heroIds = Array.isArray(options.heroIds)
    ? options.heroIds.map(Number).filter((id) => Number.isInteger(id) && id > 0)
    : [];
  const temporaryDir = path.join(identityRoot, "queries");
  const temporaryImage = path.join(temporaryDir, `${nanoid(10)}.png`);
  await mkdir(temporaryDir, { recursive: true });
  await sharp(image).png().toFile(temporaryImage);
  try {
    return await runDino([
      "match",
      "--index", indexPath,
      "--image", temporaryImage,
      "--surface", surface,
      "--hero-ids", heroIds.join(","),
      "--minimum-confidence", String(Number(options.minimumConfidence ?? 0.72)),
      "--minimum-margin", String(Number(options.minimumMargin ?? 0.03)),
    ], 120000);
  } finally {
    await rm(temporaryImage, { force: true });
  }
}

async function saveVariants(
  image: Buffer,
  surface: DinoSurface,
  heroId: number,
  heroName: string,
  source: DinoReference["source"],
  stem: string,
) {
  const directory = path.join(referencesRoot, surface, String(heroId));
  await mkdir(directory, { recursive: true });
  const output: DinoReference[] = [];
  for (const variant of ["normal", "mirror-x"] as const) {
    const target = path.join(directory, `${stem}-${variant}.png`);
    const pipeline = sharp(image).resize(224, 224, { fit: "fill" });
    await (variant === "mirror-x" ? pipeline.flop() : pipeline).png().toFile(target);
    output.push({
      id: `${surface}:${heroId}:${stem}:${variant}`,
      surface,
      heroId,
      heroName,
      variant,
      source,
      image: path.relative(identityRoot, target).replaceAll("\\", "/"),
    });
  }
  return output;
}

function toCrop(rect: [number, number, number, number], width: number, height: number) {
  const left = Math.max(0, Math.min(width - 1, Math.round(rect[0] * width)));
  const top = Math.max(0, Math.min(height - 1, Math.round(rect[1] * height)));
  return {
    left,
    top,
    width: Math.max(1, Math.min(width - left, Math.round(rect[2] * width))),
    height: Math.max(1, Math.min(height - top, Math.round(rect[3] * height))),
  };
}

async function runDino(args: string[], timeout = 30000) {
  if (!(await exists(managedPython))) throw new Error("Install the managed CV runtime before using DINO matching.");
  const { stdout } = await execFileAsync(managedPython, [script, ...args, "--project-root", projectRoot], {
    timeout,
    windowsHide: true,
    maxBuffer: 16 * 1024 * 1024,
  });
  const jsonLine = stdout.trim().split(/\r?\n/).reverse().find((line) => line.trim().startsWith("{"));
  if (!jsonLine) throw new Error("DINO identity tool returned no structured response.");
  const response = JSON.parse(jsonLine);
  if (!response.ok) throw new Error(response.error ?? "DINO identity operation failed.");
  return response.data;
}

async function readJson<T>(file: string, fallback: T) {
  try {
    return JSON.parse(await readFile(file, "utf8")) as T;
  } catch {
    return fallback;
  }
}

async function exists(file: string) {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}
