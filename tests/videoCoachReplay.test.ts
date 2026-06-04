import assert from "node:assert/strict";
import { mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { buildVideoCoachReplayEvents, writeVideoCoachReplay } from "../backend/src/services/videoCoachReplay.ts";
import type { VideoReviewSample } from "../backend/src/services/videoCvReview.ts";

const projectRoot = path.resolve(process.cwd(), "..");

test("buildVideoCoachReplayEvents evaluates draft and live_hud samples", () => {
  const samples: VideoReviewSample[] = [
    {
      sourceFrame: 0,
      timestampSeconds: 0,
      framePath: "frame-0.jpg",
      screen: "draft",
      confidence: 0.82,
      evidence: ["draft"],
    },
    {
      sourceFrame: 30,
      timestampSeconds: 1,
      framePath: "frame-30.jpg",
      screen: "live_hud",
      confidence: 0.8,
      evidence: ["live_hud"],
    },
    {
      sourceFrame: 60,
      timestampSeconds: 2,
      framePath: "frame-60.jpg",
      screen: "loading",
      confidence: 0.5,
      evidence: ["loading"],
    },
  ];
  const events = buildVideoCoachReplayEvents(samples);
  assert.equal(events.length, 2);
  assert.equal(events[0]?.ruleId, "draft_state");
  assert.ok(events[1]?.ruleId);
});

test("writeVideoCoachReplay stays under review output directory", async (t) => {
  const outputDir = path.join(projectRoot, "data", "cv", "reviews", `test-replay-${Date.now()}`);
  t.after(async () => {
    await rm(outputDir, { recursive: true, force: true });
  });
  await mkdir(outputDir, { recursive: true });
  const { replayPath, events } = await writeVideoCoachReplay(outputDir, [
    {
      sourceFrame: 0,
      timestampSeconds: 0,
      framePath: "f.jpg",
      screen: "draft",
      confidence: 0.8,
      evidence: [],
    },
  ]);
  assert.ok(replayPath.startsWith(outputDir.replace(/\\/g, "/")));
  assert.equal(events.length, 1);
  const raw = JSON.parse(await readFile(path.join(outputDir, "replay-events.json"), "utf8")) as { events: unknown[] };
  assert.equal(raw.events.length, 1);
});
