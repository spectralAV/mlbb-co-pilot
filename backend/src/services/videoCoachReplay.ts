import { writeFile } from "node:fs/promises";
import path from "node:path";
import { evaluateLiveReasoning, type LiveReasoningInput } from "../engines/liveReasoningEngine.js";
import type { OfflineVisionScreenState } from "../vision/offlineFrameClassifier.js";
import type { VideoReviewArtifact, VideoReviewSample } from "./videoCvReview.js";

export type VideoCoachReplayEvent = {
  sourceFrame: number;
  timestampSeconds: number | null;
  screen: OfflineVisionScreenState;
  confidence: number;
  ruleId: string;
  scene: string;
  callout: string;
};

const REPLAY_SCREENS = new Set<OfflineVisionScreenState>(["draft", "live_hud", "scoreboard", "death_replay"]);

function toReasoningInput(sample: VideoReviewSample): LiveReasoningInput {
  return {
    frameId: `video-review:${sample.sourceFrame}`,
    source: "video-cv-review",
    timestamp: sample.timestampSeconds !== null ? Math.round(sample.timestampSeconds * 1000) : Date.now(),
    screen: sample.screen,
    confidence: sample.confidence,
    signals: {},
  };
}

export function buildVideoCoachReplayEvents(samples: VideoReviewSample[]): VideoCoachReplayEvent[] {
  const events: VideoCoachReplayEvent[] = [];
  for (const sample of samples) {
    if (!REPLAY_SCREENS.has(sample.screen)) continue;
    const reasoning = evaluateLiveReasoning(toReasoningInput(sample));
    events.push({
      sourceFrame: sample.sourceFrame,
      timestampSeconds: sample.timestampSeconds,
      screen: sample.screen,
      confidence: sample.confidence,
      ruleId: reasoning.ruleId,
      scene: reasoning.scene,
      callout: reasoning.callout,
    });
  }
  return events;
}

export async function writeVideoCoachReplay(outputDir: string, samples: VideoReviewSample[]) {
  const events = buildVideoCoachReplayEvents(samples);
  const replayPath = path.join(outputDir, "replay-events.json");
  await writeFile(
    replayPath,
    `${JSON.stringify({ generatedAt: new Date().toISOString(), eventCount: events.length, events }, null, 2)}\n`,
    "utf8",
  );
  return { replayPath: replayPath.replace(/\\/g, "/"), events };
}

export function applyCoachReplayToReview(
  review: VideoReviewArtifact,
  replay: { replayPath: string; events: VideoCoachReplayEvent[] },
): VideoReviewArtifact {
  return {
    ...review,
    replayEvents: replay.events,
    coachIntegration: {
      ...review.coachIntegration,
      reasoningEvents: replay.events.length ? "available_offline" : "none_detected",
      matchStateReplay: review.coachIntegration.matchStateReplay,
    },
    reports: {
      ...review.reports,
      replayEvents: replay.replayPath,
    },
  };
}
