import { access, readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { ultralyticsClasses } from "../vision/cvAnnotation.js";
import { getUltralyticsTrainingStatus } from "../vision/ultralyticsTrainingJob.js";

const projectRoot = path.resolve(process.cwd(), "..");
const cvRoot = path.join(projectRoot, "data", "cv");
const analysisPath = path.join(cvRoot, "runtime", "dataset-analysis.json");
const trainingJobPath = path.join(cvRoot, "runtime", "training-job.json");
const roboflowStagingRoot = path.join(cvRoot, "roboflow-training");

export type ClassCountRow = {
  id: number;
  name: string;
  train: number;
  val: number;
};

async function exists(filePath: string) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readJsonFile<T>(filePath: string): Promise<T | null> {
  if (!(await exists(filePath))) return null;
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as T;
  } catch {
    return null;
  }
}

async function countYoloLabels(split: "train" | "val") {
  const counts = new Map<number, number>();
  const labelDir = path.join(cvRoot, "labels", split);
  if (!(await exists(labelDir))) return counts;
  const files = (await readdir(labelDir)).filter((name) => name.endsWith(".txt"));
  for (const file of files) {
    const labelPath = path.join(labelDir, file);
    let raw: string;
    try {
      raw = await readFile(labelPath, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw error;
    }
    const seen = new Set<number>();
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const classId = Number(trimmed.split(/\s+/)[0]);
      if (!Number.isInteger(classId) || classId < 0) continue;
      if (seen.has(classId)) continue;
      seen.add(classId);
      counts.set(classId, (counts.get(classId) ?? 0) + 1);
    }
  }
  return counts;
}

async function roboflowStagingSummary() {
  if (!(await exists(roboflowStagingRoot))) {
    return { present: false, modifiedAt: null as string | null, entryCount: 0 };
  }
  let latest = 0;
  let entryCount = 0;
  async function walk(dir: string) {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
        continue;
      }
      entryCount += 1;
      const info = await stat(full);
      latest = Math.max(latest, info.mtimeMs);
    }
  }
  await walk(roboflowStagingRoot);
  return {
    present: entryCount > 0,
    modifiedAt: latest > 0 ? new Date(latest).toISOString() : null,
    entryCount,
  };
}

function extractValidationMap(result: unknown): { mAP50?: number; mAP50_95?: number } | null {
  if (!result || typeof result !== "object") return null;
  const payload = result as Record<string, unknown>;
  const metrics = payload.metrics ?? payload.validation ?? payload.results;
  if (!metrics || typeof metrics !== "object") return null;
  const map = metrics as Record<string, unknown>;
  const mAP50 = Number(map["metrics/mAP50(B)"] ?? map.mAP50 ?? map.map50);
  const mAP50_95 = Number(map["metrics/mAP50-95(B)"] ?? map.mAP50_95 ?? map.map);
  return {
    ...(Number.isFinite(mAP50) ? { mAP50 } : {}),
    ...(Number.isFinite(mAP50_95) ? { mAP50_95 } : {}),
  };
}

export async function getCvDatasetQuality() {
  const [trainCounts, valCounts, analysis, persistedJob, staging] = await Promise.all([
    countYoloLabels("train"),
    countYoloLabels("val"),
    readJsonFile<Record<string, unknown>>(analysisPath),
    readJsonFile<Record<string, unknown>>(trainingJobPath),
    roboflowStagingSummary(),
  ]);

  const classRows: ClassCountRow[] = ultralyticsClasses.map((name, id) => ({
    id,
    name,
    train: trainCounts.get(id) ?? 0,
    val: valCounts.get(id) ?? 0,
  }));

  const missingVal = classRows.filter((row) => row.train > 0 && row.val === 0).map((row) => row.name);
  const emptyTrain = classRows.filter((row) => row.train === 0).map((row) => row.name);

  const trainSplit = (analysis?.splits as Record<string, unknown> | undefined)?.train as Record<string, unknown> | undefined;
  const liveJob = getUltralyticsTrainingStatus();
  const jobResult = liveJob.state === "completed" ? liveJob.result : persistedJob?.state === "completed" ? persistedJob.result : null;
  const validation = extractValidationMap(jobResult);

  return {
    generatedAt: new Date().toISOString(),
    analysisPath: (await exists(analysisPath)) ? analysisPath : null,
    analysisGeneratedAt: typeof analysis?.generatedAt === "string" ? analysis.generatedAt : null,
    recommendations: Array.isArray(analysis?.recommendations) ? analysis.recommendations : [],
    splits: analysis?.splits ?? null,
    draftMeanSlotIoU: trainSplit?.draftMeanSlotIoU ?? null,
    phone20x9Frames: (trainSplit?.aspectBuckets as Record<string, number> | undefined)?.["20:9"] ?? null,
    classRows,
    labelFiles: {
      train: [...trainCounts.values()].reduce((sum, value) => sum + value, 0),
      val: [...valCounts.values()].reduce((sum, value) => sum + value, 0),
    },
    gaps: {
      missingValClasses: missingVal,
      zeroTrainClasses: emptyTrain,
    },
    roboflowStaging: staging,
    lastTraining: {
      id: typeof persistedJob?.id === "string" ? persistedJob.id : liveJob.id || null,
      state: liveJob.state !== "idle" ? liveJob.state : (typeof persistedJob?.state === "string" ? persistedJob.state : "idle"),
      completedAt: typeof persistedJob?.updatedAt === "string" ? persistedJob.updatedAt : liveJob.updatedAt,
      validation,
    },
    hints: [
      !(await exists(analysisPath)) ? "Run npm run cv:analyze to refresh dataset-analysis.json." : null,
      missingVal.length ? `Add val labels for: ${missingVal.slice(0, 6).join(", ")}${missingVal.length > 6 ? "…" : ""}` : null,
    ].filter(Boolean),
  };
}
