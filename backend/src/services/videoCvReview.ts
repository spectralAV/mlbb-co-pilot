import { createReadStream, existsSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline";
import { nanoid } from "nanoid";
import sharp from "sharp";
import {
  classifyOfflineFramePixels,
  type OfflineVisionScreenState,
} from "../vision/offlineFrameClassifier.js";
import { inferUltralyticsFrame } from "../vision/ultralyticsVision.js";
import { applyCoachReplayToReview, writeVideoCoachReplay, type VideoCoachReplayEvent } from "./videoCoachReplay.js";

export type FootageManifest = {
  ok?: boolean;
  name?: string;
  video?: string;
  output?: string;
  fps?: number;
  width?: number;
  height?: number;
  extractedFrames?: number;
  stride?: number;
  createdAt?: string;
};

export type FootageFrameRow = {
  sourceFrame: number;
  outputFrame: string;
  timestampSeconds: number | null;
  datasetImage?: string;
  datasetLabel?: string;
};

export type VideoReviewSample = {
  sourceFrame: number;
  timestampSeconds: number | null;
  framePath: string;
  screen: OfflineVisionScreenState;
  confidence: number;
  evidence: string[];
  layoutProfile?: ReturnType<typeof classifyOfflineFramePixels>["layoutProfile"];
  yoloClasses?: string[];
  yoloDetectionCount?: number;
};

export type VideoReviewSegment = {
  screen: OfflineVisionScreenState;
  startSeconds: number;
  endSeconds: number;
  startFrame: number;
  endFrame: number;
  meanConfidence: number;
  sampleCount: number;
  evidence: string[];
};

export type VideoReviewDraftEvent = {
  type: "draft_enter" | "draft_exit" | "live_hud_enter";
  timestampSeconds: number;
  sourceFrame: number;
  screen: OfflineVisionScreenState;
  confidence: number;
};

export type VideoReviewArtifact = {
  id: string;
  createdAt: string;
  footageName: string;
  manifestPath: string;
  outputDir: string;
  sourceVideo?: string;
  fps: number;
  width: number;
  height: number;
  options: VideoReviewOptions;
  sampledFrames: number;
  segments: VideoReviewSegment[];
  draftEvents: VideoReviewDraftEvent[];
  samples: VideoReviewSample[];
  replayEvents?: VideoCoachReplayEvent[];
  summary: {
    durationSeconds: number;
    screenDurations: Partial<Record<OfflineVisionScreenState, number>>;
    dominantScreen: OfflineVisionScreenState;
    draftSeconds: number;
    liveHudSeconds: number;
  };
  coachIntegration: {
    matchStateReplay: "deferred";
    reasoningEvents: "deferred" | "available_offline" | "none_detected";
    draftAnalysis: "available_when_draft_segments_present" | "none_detected";
    links: {
      draftRoom: "/draft";
      gameAnalysis: "/analysis";
      liveCapture: "/capture";
      cvStudioVideo: "/cv-studio/video";
    };
  };
  reports: {
    json: string;
    markdown: string;
    html: string;
    replayEvents?: string;
  };
};

export type VideoReviewOptions = {
  sampleIntervalSeconds?: number;
  maxFrames?: number;
  runYolo?: boolean;
  yoloConfidence?: number;
  minSegmentConfidence?: number;
  replayCoach?: boolean;
  projectRoot?: string;
};

const defaultOptions: Required<Omit<VideoReviewOptions, "projectRoot">> = {
  sampleIntervalSeconds: 1,
  maxFrames: 180,
  runYolo: false,
  yoloConfidence: 0.55,
  minSegmentConfidence: 0.45,
  replayCoach: false,
};

function resolveProjectRoot(projectRoot?: string) {
  return path.resolve(projectRoot ?? path.join(process.cwd(), ".."));
}

function resolveFootageRoot(projectRoot?: string) {
  return path.join(resolveProjectRoot(projectRoot), "data", "cv", "footage");
}

function resolveReviewsRoot(projectRoot?: string) {
  return path.join(resolveProjectRoot(projectRoot), "data", "cv", "reviews");
}

function isPathInside(child: string, parent: string) {
  const resolvedChild = path.resolve(child);
  const resolvedParent = path.resolve(parent);
  const prefix = resolvedParent.endsWith(path.sep) ? resolvedParent : `${resolvedParent}${path.sep}`;
  return resolvedChild === resolvedParent || resolvedChild.startsWith(prefix);
}

const FOOTAGE_SLUG_PATTERN = /^[A-Za-z0-9._-]+$/;

export function normalizeFootageSlug(input: string) {
  const normalized = input.replace(/\\/g, "/").trim();
  if (!normalized) throw new Error("Footage name is required.");
  const prefix = "data/cv/footage/";
  const relative = normalized.startsWith(prefix) ? normalized.slice(prefix.length) : normalized;
  if (relative.includes("/")) throw new Error(`Invalid footage name: ${input}`);
  const slug = path.basename(relative);
  if (!slug || slug === "." || slug === ".." || !FOOTAGE_SLUG_PATTERN.test(slug)) {
    throw new Error(`Invalid footage name: ${input}`);
  }
  return slug;
}

export function sanitizeReviewSlug(value: string, fallback: string) {
  const scrub = (raw: string) => path
    .basename(raw.replace(/\\/g, "/"))
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  const slug = scrub(value);
  const safeFallback = scrub(fallback);
  return slug || safeFallback || "footage";
}

export function resolveFootageDir(input: string, projectRoot?: string) {
  const footageRoot = resolveFootageRoot(projectRoot);
  const slug = normalizeFootageSlug(input);
  const footageDir = path.join(footageRoot, slug);
  if (!isPathInside(footageDir, footageRoot)) {
    throw new Error(`Footage path escapes data/cv/footage: ${input}`);
  }
  if (!existsSync(path.join(footageDir, "manifest.json"))) {
    throw new Error(`Footage not found: ${slug}`);
  }
  return footageDir;
}

export async function listFootageManifests(projectRoot?: string) {
  const root = resolveProjectRoot(projectRoot);
  const footageRoot = path.join(root, "data", "cv", "footage");
  if (!existsSync(footageRoot)) return [];
  const entries = await readdir(footageRoot, { withFileTypes: true });
  const manifests = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const manifestPath = path.join(footageRoot, entry.name, "manifest.json");
    if (!existsSync(manifestPath)) continue;
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as FootageManifest;
    manifests.push({
      name: entry.name,
      manifestPath: manifestPath.replace(/\\/g, "/"),
      extractedFrames: manifest.extractedFrames ?? 0,
      fps: manifest.fps ?? 0,
      width: manifest.width ?? 0,
      height: manifest.height ?? 0,
      video: manifest.video ?? "",
      createdAt: manifest.createdAt ?? "",
    });
  }
  return manifests.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

export async function loadFootageManifest(footageDir: string) {
  const manifestPath = path.join(footageDir, "manifest.json");
  if (!existsSync(manifestPath)) throw new Error(`Missing manifest.json in ${footageDir}`);
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as FootageManifest;
  const rows = await parseFramesCsv(path.join(footageDir, "frames.csv"), resolveProjectRoot());
  return { manifest, manifestPath, rows, footageDir };
}

export async function parseFramesCsv(csvPath: string, projectRoot: string): Promise<FootageFrameRow[]> {
  if (!existsSync(csvPath)) throw new Error(`Missing frames.csv: ${csvPath}`);
  const rows: FootageFrameRow[] = [];
  const stream = createReadStream(csvPath, { encoding: "utf8" });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });
  let headers: string[] = [];
  for await (const line of rl) {
    if (!line.trim()) continue;
    const parts = line.split(",");
    if (!headers.length) {
      headers = parts.map((part) => part.trim());
      continue;
    }
    const record: Record<string, string> = {};
    headers.forEach((header, index) => {
      record[header] = parts[index]?.trim() ?? "";
    });
    const timestampRaw = record.timestampSeconds;
    rows.push({
      sourceFrame: Number(record.sourceFrame),
      outputFrame: record.outputFrame,
      timestampSeconds: timestampRaw ? Number(timestampRaw) : null,
      datasetImage: record.datasetImage || undefined,
      datasetLabel: record.datasetLabel || undefined,
    });
  }
  return rows.filter((row) => Number.isFinite(row.sourceFrame) && row.outputFrame);
}

export function sampleFrameRows(
  rows: FootageFrameRow[],
  options: Pick<VideoReviewOptions, "sampleIntervalSeconds" | "maxFrames"> = {},
) {
  const sampleIntervalSeconds = options.sampleIntervalSeconds ?? defaultOptions.sampleIntervalSeconds;
  const maxFrames = options.maxFrames ?? defaultOptions.maxFrames;
  if (!rows.length) return [];
  const sorted = [...rows].sort((a, b) => a.sourceFrame - b.sourceFrame);
  const sampled: FootageFrameRow[] = [];
  let nextThreshold = sorted[0].timestampSeconds ?? 0;
  for (const row of sorted) {
    const timestamp = row.timestampSeconds ?? sampled.length;
    if (sampled.length && timestamp < nextThreshold) continue;
    sampled.push(row);
    nextThreshold = timestamp + sampleIntervalSeconds;
    if (sampled.length >= maxFrames) break;
  }
  return sampled;
}

export async function classifyFrameImage(
  framePath: string,
  options: Pick<VideoReviewOptions, "runYolo" | "yoloConfidence"> = {},
): Promise<Omit<VideoReviewSample, "sourceFrame" | "timestampSeconds" | "framePath">> {
  const buffer = await readFile(framePath);
  const { data, info } = await sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const classified = classifyOfflineFramePixels(data, info.width, info.height);
  let yoloClasses: string[] | undefined;
  let yoloDetectionCount: number | undefined;
  if (options.runYolo) {
    const inference = await inferUltralyticsFrame(buffer, options.yoloConfidence ?? defaultOptions.yoloConfidence, "video-review");
    if (inference.ready && inference.detections.length) {
      yoloClasses = [...new Set(inference.detections.map((detection) => detection.className))];
      yoloDetectionCount = inference.detections.length;
    } else {
      yoloClasses = [];
      yoloDetectionCount = 0;
    }
  }
  return {
    screen: classified.screen,
    confidence: classified.confidence,
    evidence: classified.evidence,
    layoutProfile: classified.layoutProfile,
    yoloClasses,
    yoloDetectionCount,
  };
}

export function aggregateTimelineSegments(
  samples: VideoReviewSample[],
  minSegmentConfidence = defaultOptions.minSegmentConfidence,
): VideoReviewSegment[] {
  if (!samples.length) return [];
  const segments: VideoReviewSegment[] = [];
  let current: VideoReviewSegment | null = null;
  for (const sample of samples) {
    if (sample.confidence < minSegmentConfidence) continue;
    const timestamp = sample.timestampSeconds ?? 0;
    if (!current || current.screen !== sample.screen) {
      if (current) segments.push(current);
      current = {
        screen: sample.screen,
        startSeconds: timestamp,
        endSeconds: timestamp,
        startFrame: sample.sourceFrame,
        endFrame: sample.sourceFrame,
        meanConfidence: sample.confidence,
        sampleCount: 1,
        evidence: [...sample.evidence],
      };
      continue;
    }
    current.endSeconds = timestamp;
    current.endFrame = sample.sourceFrame;
    current.sampleCount += 1;
    current.meanConfidence = (current.meanConfidence * (current.sampleCount - 1) + sample.confidence) / current.sampleCount;
    for (const item of sample.evidence) {
      if (!current.evidence.includes(item)) current.evidence.push(item);
    }
  }
  if (current) segments.push(current);
  return segments;
}

export function detectDraftEvents(segments: VideoReviewSegment[]): VideoReviewDraftEvent[] {
  const events: VideoReviewDraftEvent[] = [];
  let previous: OfflineVisionScreenState | null = null;
  for (const segment of segments) {
    if (segment.screen === "draft" && previous !== "draft") {
      events.push({
        type: "draft_enter",
        timestampSeconds: segment.startSeconds,
        sourceFrame: segment.startFrame,
        screen: segment.screen,
        confidence: segment.meanConfidence,
      });
    }
    if (previous === "draft" && segment.screen !== "draft") {
      events.push({
        type: "draft_exit",
        timestampSeconds: segment.startSeconds,
        sourceFrame: segment.startFrame,
        screen: segment.screen,
        confidence: segment.meanConfidence,
      });
    }
    if (segment.screen === "live_hud" && previous !== "live_hud") {
      events.push({
        type: "live_hud_enter",
        timestampSeconds: segment.startSeconds,
        sourceFrame: segment.startFrame,
        screen: segment.screen,
        confidence: segment.meanConfidence,
      });
    }
    previous = segment.screen;
  }
  return events;
}

function formatTimestamp(seconds: number) {
  const total = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  if (hours > 0) return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  return `${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

function summarizeReview(samples: VideoReviewSample[], segments: VideoReviewSegment[]) {
  const screenDurations: Partial<Record<OfflineVisionScreenState, number>> = {};
  for (const segment of segments) {
    const duration = Math.max(0, segment.endSeconds - segment.startSeconds);
    screenDurations[segment.screen] = (screenDurations[segment.screen] ?? 0) + duration;
  }
  const durationSeconds = samples.length
    ? Math.max(...samples.map((sample) => sample.timestampSeconds ?? 0))
    : 0;
  const dominantScreen = (Object.entries(screenDurations).sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))[0]?.[0] ?? "unknown") as OfflineVisionScreenState;
  return {
    durationSeconds,
    screenDurations,
    dominantScreen,
    draftSeconds: screenDurations.draft ?? 0,
    liveHudSeconds: screenDurations.live_hud ?? 0,
  };
}

export function renderMarkdownReport(review: Omit<VideoReviewArtifact, "reports">) {
  const lines = [
    `# Video CV Review — ${review.footageName}`,
    "",
    `- Review id: \`${review.id}\``,
    `- Created: ${review.createdAt}`,
    `- Source video: ${review.sourceVideo ?? "unknown"}`,
    `- Resolution: ${review.width}x${review.height} @ ${review.fps.toFixed(2)} fps`,
    `- Sampled frames: ${review.sampledFrames}`,
    `- Dominant screen: **${review.summary.dominantScreen}**`,
    `- Draft time: ${formatTimestamp(review.summary.draftSeconds)}`,
    `- Live HUD time: ${formatTimestamp(review.summary.liveHudSeconds)}`,
    "",
    "## Timeline",
    "",
    "| Start | End | Screen | Confidence | Samples |",
    "| --- | --- | --- | ---: | ---: |",
  ];
  for (const segment of review.segments) {
    lines.push(
      `| ${formatTimestamp(segment.startSeconds)} | ${formatTimestamp(segment.endSeconds)} | ${segment.screen} | ${segment.meanConfidence.toFixed(2)} | ${segment.sampleCount} |`,
    );
  }
  if (review.draftEvents.length) {
    lines.push("", "## Draft / Match Events", "");
    for (const event of review.draftEvents) {
      lines.push(`- ${formatTimestamp(event.timestampSeconds)} — ${event.type.replace(/_/g, " ")} (${event.screen}, conf ${event.confidence.toFixed(2)})`);
    }
  }
  lines.push(
    "",
    "## Coach / Analytics",
    "",
    "- Match-state replay into live coach is deferred for batch review (avoids clobbering live capture).",
    "- Open [Draft Room](${review.coachIntegration.links.draftRoom}) for realtime draft state.",
    "- Open [Game Analysis](${review.coachIntegration.links.gameAnalysis}) for session timelines.",
    "- Use [CV Studio Video](${review.coachIntegration.links.cvStudioVideo}) for frame-level annotation.",
    "",
    "## Vision Facts (sampled)",
    "",
  );
  for (const sample of review.samples.slice(0, 12)) {
    const yolo = sample.yoloClasses?.length ? ` YOLO: ${sample.yoloClasses.join(", ")}` : "";
    lines.push(
      `- ${formatTimestamp(sample.timestampSeconds ?? 0)} frame ${sample.sourceFrame}: **${sample.screen}** (${sample.confidence.toFixed(2)})${yolo}`,
    );
  }
  if (review.samples.length > 12) lines.push(`- … ${review.samples.length - 12} more samples in JSON artifact`);
  return `${lines.join("\n")}\n`;
}

export function renderHtmlReport(review: Omit<VideoReviewArtifact, "reports">) {
  const rows = review.segments
    .map(
      (segment) =>
        `<tr><td>${formatTimestamp(segment.startSeconds)}</td><td>${formatTimestamp(segment.endSeconds)}</td><td>${segment.screen}</td><td>${segment.meanConfidence.toFixed(2)}</td><td>${segment.sampleCount}</td></tr>`,
    )
    .join("");
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Video CV Review — ${review.footageName}</title>
  <style>
    body { font-family: Segoe UI, sans-serif; background: #050505; color: #dbeafe; margin: 2rem; }
    h1, h2 { color: #67e8f9; }
    table { border-collapse: collapse; width: 100%; margin: 1rem 0; }
    th, td { border: 1px solid #1e293b; padding: 0.5rem 0.75rem; text-align: left; }
    th { background: #0f172a; }
    .meta { color: #94a3b8; }
    a { color: #22d3ee; }
  </style>
</head>
<body>
  <h1>Video CV Review — ${review.footageName}</h1>
  <p class="meta">Review ${review.id} · ${review.createdAt}</p>
  <p>Dominant screen: <strong>${review.summary.dominantScreen}</strong> · Draft ${formatTimestamp(review.summary.draftSeconds)} · Live HUD ${formatTimestamp(review.summary.liveHudSeconds)}</p>
  <h2>Timeline</h2>
  <table>
    <thead><tr><th>Start</th><th>End</th><th>Screen</th><th>Confidence</th><th>Samples</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <h2>Coach Links</h2>
  <ul>
    <li><a href="${review.coachIntegration.links.draftRoom}">Draft Room</a></li>
    <li><a href="${review.coachIntegration.links.gameAnalysis}">Game Analysis</a></li>
    <li><a href="${review.coachIntegration.links.cvStudioVideo}">CV Studio Video</a></li>
  </ul>
</body>
</html>`;
}

function resolveFramePath(footageDir: string, row: FootageFrameRow) {
  const frameName = path.basename(row.outputFrame.replace(/\//g, path.sep));
  if (!frameName || frameName === "." || frameName === "..") {
    throw new Error(`Invalid frame path: ${row.outputFrame}`);
  }
  const resolved = path.resolve(footageDir, frameName);
  if (!isPathInside(resolved, footageDir)) {
    throw new Error(`Frame path escapes footage directory: ${row.outputFrame}`);
  }
  if (!existsSync(resolved)) throw new Error(`Frame not found: ${row.outputFrame}`);
  return resolved;
}

export async function runVideoCvReview(input: string, options: VideoReviewOptions = {}) {
  const projectRoot = resolveProjectRoot(options.projectRoot);
  const footageDir = resolveFootageDir(input, projectRoot);
  const { manifest, manifestPath, rows } = await loadFootageManifest(footageDir);
  const merged = { ...defaultOptions, ...options };
  const sampledRows = sampleFrameRows(rows, merged);
  const samples: VideoReviewSample[] = [];

  for (const row of sampledRows) {
    const framePath = resolveFramePath(footageDir, row);
    const classified = await classifyFrameImage(framePath, merged);
    samples.push({
      sourceFrame: row.sourceFrame,
      timestampSeconds: row.timestampSeconds,
      framePath: framePath.replace(/\\/g, "/"),
      ...classified,
    });
  }

  const segments = aggregateTimelineSegments(samples, merged.minSegmentConfidence);
  const draftEvents = detectDraftEvents(segments);
  const footageSlug = path.basename(footageDir);
  const footageName = sanitizeReviewSlug(manifest.name ?? footageSlug, footageSlug);
  const reviewId = `${footageName}-${nanoid(8)}`;
  const reviewsRoot = resolveReviewsRoot(projectRoot);
  const outputDir = path.join(reviewsRoot, reviewId);
  if (!isPathInside(outputDir, reviewsRoot)) {
    throw new Error("Review output path escapes data/cv/reviews.");
  }
  await mkdir(outputDir, { recursive: true });

  const baseReview: Omit<VideoReviewArtifact, "reports"> = {
    id: reviewId,
    createdAt: new Date().toISOString(),
    footageName,
    manifestPath: manifestPath.replace(/\\/g, "/"),
    outputDir: outputDir.replace(/\\/g, "/"),
    sourceVideo: manifest.video,
    fps: manifest.fps ?? 0,
    width: manifest.width ?? 0,
    height: manifest.height ?? 0,
    options: merged,
    sampledFrames: samples.length,
    segments,
    draftEvents,
    samples,
    summary: summarizeReview(samples, segments),
    coachIntegration: {
      matchStateReplay: "deferred",
      reasoningEvents: "deferred",
      draftAnalysis: draftEvents.length ? "available_when_draft_segments_present" : "none_detected",
      links: {
        draftRoom: "/draft",
        gameAnalysis: "/analysis",
        liveCapture: "/capture",
        cvStudioVideo: "/cv-studio/video",
      },
    },
  };

  const jsonPath = path.join(outputDir, "review.json");
  const markdownPath = path.join(outputDir, "review.md");
  const htmlPath = path.join(outputDir, "review.html");
  const markdown = renderMarkdownReport(baseReview);
  const html = renderHtmlReport(baseReview);
  let artifact: VideoReviewArtifact = {
    ...baseReview,
    reports: {
      json: jsonPath.replace(/\\/g, "/"),
      markdown: markdownPath.replace(/\\/g, "/"),
      html: htmlPath.replace(/\\/g, "/"),
    },
  };
  if (merged.replayCoach) {
    const replay = await writeVideoCoachReplay(outputDir, samples);
    artifact = applyCoachReplayToReview(artifact, replay);
  }
  await writeFile(jsonPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
  await writeFile(markdownPath, markdown, "utf8");
  await writeFile(htmlPath, html, "utf8");
  return artifact;
}

export async function listVideoReviews(projectRoot?: string) {
  const root = resolveProjectRoot(projectRoot);
  const reviewsRoot = path.join(root, "data", "cv", "reviews");
  if (!existsSync(reviewsRoot)) return [];
  const entries = await readdir(reviewsRoot, { withFileTypes: true });
  const reviews = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const jsonPath = path.join(reviewsRoot, entry.name, "review.json");
    if (!existsSync(jsonPath)) continue;
    const review = JSON.parse(await readFile(jsonPath, "utf8")) as VideoReviewArtifact;
    reviews.push({
      id: review.id,
      footageName: review.footageName,
      createdAt: review.createdAt,
      sampledFrames: review.sampledFrames,
      dominantScreen: review.summary.dominantScreen,
      draftEvents: review.draftEvents.length,
      reports: review.reports,
    });
  }
  return reviews.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

export async function getVideoReview(reviewId: string, projectRoot?: string) {
  const reviewsRoot = resolveReviewsRoot(projectRoot);
  const safeId = path.basename(reviewId);
  if (!safeId || safeId === "." || safeId === "..") return null;
  const reviewDir = path.join(reviewsRoot, safeId);
  const jsonPath = path.join(reviewDir, "review.json");
  if (!isPathInside(jsonPath, reviewsRoot) || !existsSync(jsonPath)) return null;
  let artifact = JSON.parse(await readFile(jsonPath, "utf8")) as VideoReviewArtifact;
  const replayPath = path.join(reviewDir, "replay-events.json");
  if (isPathInside(replayPath, reviewsRoot) && existsSync(replayPath) && !artifact.replayEvents?.length) {
    try {
      const replay = JSON.parse(await readFile(replayPath, "utf8")) as { events?: VideoCoachReplayEvent[] };
      if (Array.isArray(replay.events) && replay.events.length) {
        artifact = {
          ...artifact,
          replayEvents: replay.events,
          coachIntegration: {
            ...artifact.coachIntegration,
            reasoningEvents: "available_offline",
          },
          reports: {
            ...artifact.reports,
            replayEvents: replayPath.replace(/\\/g, "/"),
          },
        };
      }
    } catch {
      // Keep review.json payload when replay artifact is unreadable.
    }
  }
  return artifact;
}
