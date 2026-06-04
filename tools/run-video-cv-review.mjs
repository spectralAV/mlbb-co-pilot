/**
 * Batch CV review over extracted footage manifest.
 *
 * Usage:
 *   node tools/run-video-cv-review.mjs ranked-match-01
 *   node tools/run-video-cv-review.mjs data/cv/footage/ranked-match-01 --interval 2 --max-frames 60
 *   node tools/run-video-cv-review.mjs ranked-match-01 --yolo
 */
import { runVideoCvReview } from "../backend/src/services/videoCvReview.ts";

const args = process.argv.slice(2);
if (!args.length || args.includes("--help") || args.includes("-h")) {
  console.log(`Usage: node tools/run-video-cv-review.mjs <footage-name-or-path> [options]

Options:
  --interval <seconds>   Sample one frame per interval (default 1)
  --max-frames <n>       Cap sampled frames (default 180)
  --yolo                 Run local Ultralytics YOLO on sampled frames
  --yolo-confidence <n>  YOLO confidence gate (default 0.55)
  --min-confidence <n>   Segment confidence gate (default 0.45)
`);
  process.exit(args.length ? 0 : 1);
}

const footage = args[0];
function readFlag(name, fallback) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : fallback;
}

const sampleIntervalSeconds = Number(readFlag("--interval", "1"));
const maxFrames = Number(readFlag("--max-frames", "180"));
const yoloConfidence = Number(readFlag("--yolo-confidence", "0.55"));
const minSegmentConfidence = Number(readFlag("--min-confidence", "0.45"));
const runYolo = args.includes("--yolo");

try {
  const review = await runVideoCvReview(footage, {
    sampleIntervalSeconds,
    maxFrames,
    runYolo,
    yoloConfidence,
    minSegmentConfidence,
  });
  console.log(JSON.stringify({
    ok: true,
    id: review.id,
    footageName: review.footageName,
    sampledFrames: review.sampledFrames,
    segments: review.segments.length,
    draftEvents: review.draftEvents.length,
    dominantScreen: review.summary.dominantScreen,
    reports: review.reports,
  }, null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
