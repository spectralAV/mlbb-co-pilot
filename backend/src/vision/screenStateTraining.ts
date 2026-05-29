import { execFile } from "node:child_process";
import { access, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import sharp from "sharp";
import { cache } from "../services/cacheService.js";

const execFileAsync = promisify(execFile);
const projectRoot = path.resolve(process.cwd(), "..");
const trainingSetPath = path.join(projectRoot, "data", "recognition-samples", "screen-state-training-set.json");
const outputDir = path.join(projectRoot, "data", "recognition-samples", "raw", "screen-state-training");
const modelFile = "cv-screen-state-model.json";
const featureRegions = {
  minimap: [0.02521, 0, 0.146359, 0.326563],
  top_hud: [0.28, 0, 0.45, 0.08],
  draft_left_rail: [0, 0.08, 0.22, 0.84],
  draft_right_rail: [0.78, 0.08, 0.22, 0.84],
  center_panel: [0.27, 0.1, 0.48, 0.64],
  modal_body: [0.1, 0.13, 0.8, 0.78],
} as const;
const featureKeys = Object.keys(featureRegions).flatMap((key) => [`${key}.mean`, `${key}.contrast`]);

type ScreenLabel = "draft" | "loading" | "live_hud";
type TrainingSplit = "train" | "validation";
type SourceSample = { second: number; label: ScreenLabel; split: TrainingSplit };
type TrainingConfig = {
  version: string;
  recordings: Array<{ id: string; file: string; samples: SourceSample[] }>;
};
type Example = SourceSample & {
  recordingId: string;
  frame: string;
  features: number[];
};
export type TrainedScreenStateModel = {
  version: string;
  trainedAt: string;
  source: string;
  featureKeys: string[];
  normalization: { mean: number[]; scale: number[] };
  classes: Array<{ label: ScreenLabel; centroid: number[]; acceptanceDistance: number; trainingExamples: number }>;
  training: { examples: number; labels: Record<ScreenLabel, number> };
  validation: {
    examples: number;
    correct: number;
    accuracy: number;
    predictions: Array<{ recordingId: string; second: number; expected: ScreenLabel; predicted: ScreenLabel; accepted: boolean; confidence: number }>;
  };
};

export async function getScreenStateTrainingStatus() {
  const model = await cache.read<TrainedScreenStateModel | null>(modelFile, null);
  return {
    available: Boolean(model),
    model,
    trainingSet: trainingSetPath,
  };
}

export async function getScreenStateModel() {
  return cache.read<TrainedScreenStateModel | null>(modelFile, null);
}

export async function trainScreenStateModel() {
  const config = JSON.parse(await readFile(trainingSetPath, "utf8")) as TrainingConfig;
  const ffmpeg = await resolveFfmpeg();
  await mkdir(outputDir, { recursive: true });
  const examples: Example[] = [];
  for (const recording of config.recordings) {
    const source = path.resolve(projectRoot, recording.file);
    await access(source);
    for (const sample of recording.samples) {
      const frame = path.join(outputDir, `${recording.id}-${sample.label}-${sample.split}-${sample.second}.jpg`);
      await execFileAsync(ffmpeg, [
        "-y", "-loglevel", "error", "-ss", String(sample.second), "-i", source, "-frames:v", "1", frame,
      ], { timeout: 30000, maxBuffer: 1024 * 1024 });
      examples.push({
        ...sample,
        recordingId: recording.id,
        frame,
        features: await extractFeatures(frame),
      });
    }
  }
  const training = examples.filter((example) => example.split === "train");
  const validation = examples.filter((example) => example.split === "validation");
  const normalization = normalizeTraining(training);
  const normalizedTraining = training.map((example) => ({ ...example, normalized: normalize(example.features, normalization) }));
  const labels = ["draft", "loading", "live_hud"] as ScreenLabel[];
  const classes = labels.map((label) => {
    const items = normalizedTraining.filter((example) => example.label === label);
    const centroid = centroidOf(items.map((example) => example.normalized));
    const farthest = Math.max(...items.map((example) => distance(example.normalized, centroid)), 0.1);
    return {
      label,
      centroid,
      acceptanceDistance: round(farthest * 1.35 + 0.08),
      trainingExamples: items.length,
    };
  });
  const partialModel = { normalization, classes };
  const predictions = validation.map((example) => {
    const prediction = predict(example.features, partialModel);
    return {
      recordingId: example.recordingId,
      second: example.second,
      expected: example.label,
      predicted: prediction.label,
      accepted: prediction.accepted,
      confidence: prediction.confidence,
    };
  });
  const correct = predictions.filter((prediction) => prediction.predicted === prediction.expected && prediction.accepted).length;
  const model: TrainedScreenStateModel = {
    version: config.version,
    trainedAt: new Date().toISOString(),
    source: path.relative(projectRoot, trainingSetPath).replaceAll("\\", "/"),
    featureKeys,
    normalization,
    classes,
    training: {
      examples: training.length,
      labels: Object.fromEntries(labels.map((label) => [label, training.filter((example) => example.label === label).length])) as Record<ScreenLabel, number>,
    },
    validation: {
      examples: validation.length,
      correct,
      accuracy: round(validation.length ? correct / validation.length : 0),
      predictions,
    },
  };
  await cache.write(modelFile, model);
  return model;
}

async function resolveFfmpeg() {
  const candidates = [
    process.env.FFMPEG_PATH,
    "ffmpeg.exe",
    path.resolve(projectRoot, "..", "OBS scrcpy source plugin", "vendor", "ffmpeg-8.0.1-full_build-shared", "bin", "ffmpeg.exe"),
  ].filter(Boolean) as string[];
  for (const candidate of candidates) {
    if (!path.isAbsolute(candidate)) {
      try {
        await execFileAsync(candidate, ["-version"], { timeout: 5000 });
        return candidate;
      } catch {
        continue;
      }
    }
    try {
      await access(candidate);
      return candidate;
    } catch {
      continue;
    }
  }
  throw new Error("ffmpeg is required to extract labeled training frames. Set FFMPEG_PATH or install ffmpeg.");
}

async function extractFeatures(file: string) {
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return Object.values(featureRegions).flatMap((rect) => {
    const metric = sampleMetric(data, info.width, info.height, rect);
    return [metric.mean, metric.contrast];
  });
}

function sampleMetric(rgba: Buffer, width: number, height: number, rect: readonly number[]) {
  const x = Math.max(0, Math.floor(rect[0] * width));
  const y = Math.max(0, Math.floor(rect[1] * height));
  const w = Math.max(1, Math.min(width - x, Math.floor(rect[2] * width)));
  const h = Math.max(1, Math.min(height - y, Math.floor(rect[3] * height)));
  const stride = Math.max(1, Math.floor((w * h) / 900));
  let sum = 0;
  let sumSquared = 0;
  let count = 0;
  for (let point = 0; point < w * h; point += stride) {
    const px = x + (point % w);
    const py = y + Math.floor(point / w);
    if (py >= y + h) break;
    const index = (py * width + px) * 4;
    const luma = rgba[index] * 0.299 + rgba[index + 1] * 0.587 + rgba[index + 2] * 0.114;
    sum += luma;
    sumSquared += luma * luma;
    count += 1;
  }
  const mean = count ? sum / count : 0;
  return { mean, contrast: Math.sqrt(Math.max(0, sumSquared / Math.max(1, count) - mean * mean)) };
}

function normalizeTraining(examples: Example[]) {
  const mean = featureKeys.map((_, index) =>
    examples.reduce((sum, example) => sum + example.features[index], 0) / Math.max(1, examples.length));
  const scale = featureKeys.map((_, index) => {
    const variance = examples.reduce((sum, example) => sum + (example.features[index] - mean[index]) ** 2, 0) / Math.max(1, examples.length);
    return Math.max(1, Math.sqrt(variance));
  });
  return { mean: mean.map(round), scale: scale.map(round) };
}

function normalize(features: number[], normalization: { mean: number[]; scale: number[] }) {
  return features.map((value, index) => (value - normalization.mean[index]) / normalization.scale[index]);
}

function centroidOf(items: number[][]) {
  return featureKeys.map((_, index) => round(items.reduce((sum, item) => sum + item[index], 0) / Math.max(1, items.length)));
}

function distance(left: number[], right: number[]) {
  return Math.sqrt(left.reduce((sum, value, index) => sum + (value - right[index]) ** 2, 0) / Math.max(1, left.length));
}

function predict(features: number[], model: Pick<TrainedScreenStateModel, "normalization" | "classes">) {
  const normalized = normalize(features, model.normalization);
  const ranking = model.classes
    .map((entry) => ({ ...entry, distance: distance(normalized, entry.centroid) }))
    .sort((left, right) => left.distance - right.distance);
  const best = ranking[0];
  const second = ranking[1];
  const separation = Math.max(0, Number(second?.distance ?? best.distance + 1) - best.distance);
  const accepted = best.distance <= best.acceptanceDistance;
  const confidence = round(Math.max(0, Math.min(1, 0.45 + separation * 0.18 + (accepted ? 0.22 : -0.18))));
  return { label: best.label, accepted, confidence };
}

function round(value: number) {
  return Math.round(value * 10000) / 10000;
}
