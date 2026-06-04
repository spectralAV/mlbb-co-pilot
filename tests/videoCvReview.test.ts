import assert from "node:assert/strict";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import {
  aggregateTimelineSegments,
  detectDraftEvents,
  getVideoReview,
  normalizeFootageSlug,
  resolveFootageDir,
  sampleFrameRows,
  sanitizeReviewSlug,
  type FootageFrameRow,
  type VideoReviewSample,
} from "../backend/src/services/videoCvReview.ts";

const projectRoot = path.resolve(process.cwd(), "..");

function row(sourceFrame: number, timestampSeconds: number): FootageFrameRow {
  return { sourceFrame, outputFrame: `frame-${sourceFrame}.jpg`, timestampSeconds };
}

function sample(sourceFrame: number, timestampSeconds: number, screen: VideoReviewSample["screen"], confidence: number): VideoReviewSample {
  return {
    sourceFrame,
    timestampSeconds,
    framePath: `frame-${sourceFrame}.jpg`,
    screen,
    confidence,
    evidence: [screen],
  };
}

test("sampleFrameRows respects interval and max frame cap", () => {
  const rows = [row(0, 0), row(15, 0.5), row(30, 1), row(45, 1.5), row(60, 2), row(75, 2.5)];
  const sampled = sampleFrameRows(rows, { sampleIntervalSeconds: 1, maxFrames: 3 });
  assert.deepEqual(
    sampled.map((entry) => entry.sourceFrame),
    [0, 30, 60],
  );
});

test("sampleFrameRows keeps first frame when timestamps are missing", () => {
  const rows = [
    { sourceFrame: 10, outputFrame: "a.jpg", timestampSeconds: null },
    { sourceFrame: 20, outputFrame: "b.jpg", timestampSeconds: null },
  ];
  const sampled = sampleFrameRows(rows, { sampleIntervalSeconds: 1, maxFrames: 5 });
  assert.equal(sampled.length, 2);
});

test("aggregateTimelineSegments merges consecutive screens", () => {
  const samples = [
    sample(0, 0, "draft", 0.8),
    sample(30, 1, "draft", 0.82),
    sample(60, 2, "live_hud", 0.74),
    sample(90, 3, "live_hud", 0.76),
  ];
  const segments = aggregateTimelineSegments(samples, 0.45);
  assert.equal(segments.length, 2);
  assert.equal(segments[0]?.screen, "draft");
  assert.equal(segments[0]?.sampleCount, 2);
  assert.equal(segments[1]?.screen, "live_hud");
});

test("aggregateTimelineSegments drops low-confidence samples", () => {
  const samples = [
    sample(0, 0, "draft", 0.8),
    sample(30, 1, "unknown", 0.2),
    sample(60, 2, "live_hud", 0.74),
  ];
  const segments = aggregateTimelineSegments(samples, 0.45);
  assert.equal(segments.length, 2);
  assert.equal(segments[0]?.screen, "draft");
  assert.equal(segments[1]?.screen, "live_hud");
});

test("detectDraftEvents emits enter and exit markers", () => {
  const segments = aggregateTimelineSegments([
    sample(0, 0, "draft", 0.8),
    sample(30, 1, "draft", 0.82),
    sample(60, 2, "loading", 0.6),
    sample(90, 3, "live_hud", 0.74),
  ]);
  const events = detectDraftEvents(segments);
  assert.deepEqual(
    events.map((event) => event.type),
    ["draft_enter", "draft_exit", "live_hud_enter"],
  );
});

test("normalizeFootageSlug accepts folder names and data/cv/footage prefix", () => {
  assert.equal(normalizeFootageSlug("ranked-match-01"), "ranked-match-01");
  assert.equal(normalizeFootageSlug("data/cv/footage/ranked-match-01"), "ranked-match-01");
});

test("normalizeFootageSlug rejects traversal and unsafe characters", () => {
  assert.throws(() => normalizeFootageSlug("../../../etc/passwd"), /Invalid footage name/);
  assert.throws(() => normalizeFootageSlug("foo/bar"), /Invalid footage name/);
  assert.throws(() => normalizeFootageSlug(""), /required/i);
});

test("sanitizeReviewSlug strips path segments from manifest names", () => {
  assert.equal(sanitizeReviewSlug("../../evil", "fallback"), "evil");
  assert.equal(sanitizeReviewSlug("", "safe-name"), "safe-name");
});

test("resolveFootageDir resolves only under data/cv/footage", async (t) => {
  const slug = `test-footage-${Date.now()}`;
  const footageDir = path.join(projectRoot, "data", "cv", "footage", slug);
  t.after(async () => {
    await rm(footageDir, { recursive: true, force: true });
  });
  await mkdir(footageDir, { recursive: true });
  await writeFile(path.join(footageDir, "manifest.json"), JSON.stringify({ name: slug }), "utf8");

  assert.equal(resolveFootageDir(slug, projectRoot), footageDir);
  assert.equal(resolveFootageDir(`data/cv/footage/${slug}`, projectRoot), footageDir);
  assert.throws(() => resolveFootageDir("missing-footage-manifest", projectRoot), /Footage not found/);
});

test("getVideoReview rejects traversal review ids", async () => {
  assert.equal(await getVideoReview("../../../package.json", projectRoot), null);
  assert.equal(await getVideoReview("..", projectRoot), null);
});
