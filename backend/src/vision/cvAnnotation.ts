import { access, mkdir, readFile, readdir, rm, writeFile, copyFile } from "node:fs/promises";
import path from "node:path";
import { nanoid } from "nanoid";
import sharp from "sharp";

export type AnnotationSplit = "train" | "val";
export type AnnotationBox = {
  classId: number;
  className: string;
  rect: [number, number, number, number];
  heroId?: number;
  heroName?: string;
  transcript?: string;
};

export const ultralyticsClasses = [
  "minimap_panel",
  "draft_screen",
  "equipment_scoreboard",
  "attributes_scoreboard",
  "ally_pick_slot",
  "enemy_pick_slot",
  "ally_ban_slot",
  "enemy_ban_slot",
  "lane_marker",
  "battle_spell_marker",
  "ally_hero_marker",
  "enemy_hero_marker",
  "turtle",
  "lord",
  "ally_turret",
  "enemy_turret",
  "turtle_respawn_timer",
  "lord_respawn_timer",
  "enemy_respawn_timer",
  "ally_respawn_timer",
  "minimap_objective_timer",
  "score_counter",
  "match_timer",
  "ally_kill_counter",
  "enemy_kill_counter",
  "personal_kda",
  "personal_gold_counter",
  "live_hud_stats_region",
  "red_buff",
  "blue_buff",
  "jungle_creep",
  "little_wonder",
  "post_match_item_slot",
] as const;

type AnnotationMetadata = {
  id: string;
  split: AnnotationSplit;
  source: string;
  width: number;
  height: number;
  boxes: AnnotationBox[];
  imageName: string;
  createdAt: string;
  updatedAt?: string;
};

const projectRoot = path.resolve(process.cwd(), "..");
const cvRoot = path.join(projectRoot, "data", "cv");
const annotationRoot = path.join(cvRoot, "annotations");

export function getAnnotationClasses() {
  return ultralyticsClasses.map((name, id) => ({ id, name, group: groupForClass(name) }));
}

export async function listAnnotations() {
  const annotations: AnnotationMetadata[] = [];
  for (const split of ["train", "val"] as const) {
    const directory = path.join(annotationRoot, "metadata", split);
    if (!(await exists(directory))) continue;
    for (const name of await readdir(directory)) {
      if (!name.endsWith(".json")) continue;
      const metadata = JSON.parse(await readFile(path.join(directory, name), "utf8")) as AnnotationMetadata;
      annotations.push(metadata);
    }
  }
  return annotations.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

export async function saveAnnotation(
  image: Buffer,
  input: { split?: unknown; source?: unknown; boxes?: unknown; allowEmpty?: unknown },
) {
  const split: AnnotationSplit = input.split === "val" ? "val" : "train";
  const boxes = normalizeAnnotationBoxes(input.boxes);
  if (!boxes.length && input.allowEmpty !== true) throw new Error("Draw at least one annotation box before saving.");
  const info = await sharp(image).metadata();
  if (!info.width || !info.height) throw new Error("Could not read annotation image dimensions.");
  const id = `user-${new Date().toISOString().replace(/[:.]/g, "-")}-${nanoid(6)}`;
  const imageName = `${id}.jpg`;
  const labelName = `${id}.txt`;
  const metadata: AnnotationMetadata = {
    id,
    split,
    source: String(input.source ?? "cv-lab"),
    width: info.width,
    height: info.height,
    boxes,
    imageName,
    createdAt: new Date().toISOString(),
  };
  const canonicalImage = path.join(annotationRoot, "images", split, imageName);
  const canonicalLabel = path.join(annotationRoot, "labels", split, labelName);
  const metadataFile = path.join(annotationRoot, "metadata", split, `${id}.json`);
  const activeImage = path.join(cvRoot, "images", split, imageName);
  const activeLabel = path.join(cvRoot, "labels", split, labelName);
  await Promise.all([
    mkdir(path.dirname(canonicalImage), { recursive: true }),
    mkdir(path.dirname(canonicalLabel), { recursive: true }),
    mkdir(path.dirname(metadataFile), { recursive: true }),
    mkdir(path.dirname(activeImage), { recursive: true }),
    mkdir(path.dirname(activeLabel), { recursive: true }),
  ]);
  await sharp(image).jpeg({ quality: 94 }).toFile(canonicalImage);
  const labels = boxes.length ? boxes.map(toYoloLine).join("\n") + "\n" : "";
  await Promise.all([
    writeFile(canonicalLabel, labels, "ascii"),
    writeFile(metadataFile, JSON.stringify(metadata, null, 2) + "\n", "ascii"),
  ]);
  await Promise.all([copyFile(canonicalImage, activeImage), copyFile(canonicalLabel, activeLabel)]);
  return metadata;
}

export async function updateAnnotation(
  id: string,
  input: { split?: unknown; source?: unknown; boxes?: unknown; allowEmpty?: unknown },
) {
  const safeId = path.basename(id);
  const samples = await listAnnotations();
  const current = samples.find((entry) => entry.id === safeId);
  if (!current) return null;

  const split: AnnotationSplit = input.split === "val" ? "val" : "train";
  const boxes = normalizeAnnotationBoxes(input.boxes);
  if (!boxes.length && input.allowEmpty !== true) throw new Error("Keep at least one annotation box or save as an empty negative frame.");

  const canonicalImage = path.join(annotationRoot, "images", current.split, current.imageName);
  if (!(await exists(canonicalImage))) throw new Error("Annotation image is missing.");

  const nextSource = String(input.source ?? current.source).trim() || current.source;
  const metadata: AnnotationMetadata = {
    ...current,
    split,
    source: nextSource.slice(0, 180),
    boxes,
    updatedAt: new Date().toISOString(),
  };

  const nextImage = path.join(annotationRoot, "images", split, current.imageName);
  const nextLabel = path.join(annotationRoot, "labels", split, `${current.id}.txt`);
  const nextMetadata = path.join(annotationRoot, "metadata", split, `${current.id}.json`);
  const previousLabel = path.join(annotationRoot, "labels", current.split, `${current.id}.txt`);
  const previousMetadata = path.join(annotationRoot, "metadata", current.split, `${current.id}.json`);
  const activeImage = path.join(cvRoot, "images", split, current.imageName);
  const activeLabel = path.join(cvRoot, "labels", split, `${current.id}.txt`);
  const previousActiveImage = path.join(cvRoot, "images", current.split, current.imageName);
  const previousActiveLabel = path.join(cvRoot, "labels", current.split, `${current.id}.txt`);
  const labels = boxes.length ? boxes.map(toYoloLine).join("\n") + "\n" : "";

  await Promise.all([
    mkdir(path.dirname(nextImage), { recursive: true }),
    mkdir(path.dirname(nextLabel), { recursive: true }),
    mkdir(path.dirname(nextMetadata), { recursive: true }),
    mkdir(path.dirname(activeImage), { recursive: true }),
    mkdir(path.dirname(activeLabel), { recursive: true }),
  ]);
  if (current.split !== split) {
    await copyFile(canonicalImage, nextImage);
  }
  await Promise.all([
    writeFile(nextLabel, labels, "ascii"),
    writeFile(nextMetadata, JSON.stringify(metadata, null, 2) + "\n", "utf8"),
    copyFile(current.split === split ? canonicalImage : nextImage, activeImage),
    writeFile(activeLabel, labels, "ascii"),
  ]);
  if (current.split !== split) {
    await Promise.all([
      rm(canonicalImage, { force: true }),
      rm(previousLabel, { force: true }),
      rm(previousMetadata, { force: true }),
      rm(previousActiveImage, { force: true }),
      rm(previousActiveLabel, { force: true }),
    ]);
  }
  return metadata;
}

export async function syncSavedAnnotationsToDataset() {
  const samples = await listAnnotations();
  for (const sample of samples) {
    const image = path.join(annotationRoot, "images", sample.split, sample.imageName);
    const label = path.join(annotationRoot, "labels", sample.split, `${sample.id}.txt`);
    if (!(await exists(image)) || !(await exists(label))) continue;
    await mkdir(path.join(cvRoot, "images", sample.split), { recursive: true });
    await mkdir(path.join(cvRoot, "labels", sample.split), { recursive: true });
    await copyFile(image, path.join(cvRoot, "images", sample.split, sample.imageName));
    await copyFile(label, path.join(cvRoot, "labels", sample.split, `${sample.id}.txt`));
  }
  return samples.length;
}

export async function deleteAnnotation(id: string) {
  const safeId = path.basename(id);
  const samples = await listAnnotations();
  const sample = samples.find((entry) => entry.id === safeId);
  if (!sample) return false;
  await Promise.all([
    rm(path.join(annotationRoot, "images", sample.split, sample.imageName), { force: true }),
    rm(path.join(annotationRoot, "labels", sample.split, `${sample.id}.txt`), { force: true }),
    rm(path.join(annotationRoot, "metadata", sample.split, `${sample.id}.json`), { force: true }),
    rm(path.join(cvRoot, "images", sample.split, sample.imageName), { force: true }),
    rm(path.join(cvRoot, "labels", sample.split, `${sample.id}.txt`), { force: true }),
  ]);
  return true;
}

export async function annotationImage(id: string) {
  const safeId = path.basename(id);
  const sample = (await listAnnotations()).find((entry) => entry.id === safeId);
  if (!sample) return null;
  const image = path.join(annotationRoot, "images", sample.split, sample.imageName);
  return (await exists(image)) ? image : null;
}

export function normalizeAnnotationBoxes(value: unknown): AnnotationBox[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((box: any) => {
    const classId = Number(box?.classId);
    const rect = Array.isArray(box?.rect) ? box.rect.map(Number) : [];
    if (!Number.isInteger(classId) || !ultralyticsClasses[classId] || rect.length !== 4) return [];
    const normalizedRect = normalizeAnnotationRect(rect);
    if (!normalizedRect) return [];
    const className = ultralyticsClasses[classId];
    const annotation: AnnotationBox = { classId, className, rect: normalizedRect };
    if (isHeroMarkerClass(className)) {
      const heroId = Number(box?.heroId);
      const heroName = String(box?.heroName ?? "").trim();
      if (Number.isInteger(heroId) && heroId > 0 && heroName) {
        annotation.heroId = heroId;
        annotation.heroName = heroName.slice(0, 80);
      }
    }
    if (isTranscriptClass(className)) {
      const transcript = String(box?.transcript ?? "").trim();
      if (isValidTranscript(className, transcript)) annotation.transcript = transcript;
    }
    return [annotation];
  });
}

function normalizeAnnotationRect(rect: number[]): [number, number, number, number] | null {
  const [rawLeft, rawTop, rawWidth, rawHeight] = rect;
  if (![rawLeft, rawTop, rawWidth, rawHeight].every(Number.isFinite)) return null;
  if (rawWidth <= 0 || rawHeight <= 0) return null;
  const left = clamp01(rawLeft);
  const top = clamp01(rawTop);
  const right = clamp01(rawLeft + rawWidth);
  const bottom = clamp01(rawTop + rawHeight);
  const width = right - left;
  const height = bottom - top;
  if (width < 0.001 || height < 0.001) return null;
  return [left, top, width, height].map(roundRectValue) as [number, number, number, number];
}

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}

function roundRectValue(value: number) {
  return Number(value.toFixed(6));
}

function toYoloLine(box: AnnotationBox) {
  const [x, y, width, height] = box.rect;
  return `${box.classId} ${(x + width / 2).toFixed(6)} ${(y + height / 2).toFixed(6)} ${width.toFixed(6)} ${height.toFixed(6)}`;
}

function groupForClass(name: string) {
  if (name.includes("respawn") || name.includes("counter") || name.includes("timer") || name.includes("kda")) return "Counters";
  if (name.includes("minimap") || name.includes("turret") || name.includes("buff") || name.includes("wonder") || name.includes("creep") || ["turtle", "lord"].includes(name)) return "Map";
  if (name.includes("pick") || name.includes("ban") || name.includes("lane") || name.includes("spell") || name.includes("draft")) return "Draft";
  if (name.includes("item")) return "Items";
  return "HUD";
}

function isHeroMarkerClass(name: string) {
  return name === "ally_hero_marker" || name === "enemy_hero_marker";
}

function isTranscriptClass(name: string) {
  return name.includes("respawn") || name.includes("counter") || name.includes("timer") || name.includes("kda");
}

function isValidTranscript(name: string, transcript: string) {
  if (name === "personal_kda") return /^\d{1,2}\s*[/:.-]\s*\d{1,2}\s*[/:.-]\s*\d{1,2}$/.test(transcript);
  return /^\d{1,4}(?::\d{2})?$/.test(transcript);
}

async function exists(file: string) {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}
