import type { LiveVisionFrame, VisionScreenState } from "./captureRuntime.ts";

export function frameHasDraftYoloEvidence(evidence: string[] | undefined) {
  if (!evidence?.length) return false;
  return evidence.some((line) => /draft|yolo.*slot|pick_slot|ban_slot|draft_screen/i.test(line));
}

export function requiredStableFrames(
  current: VisionScreenState | null,
  next: VisionScreenState,
  confidence: number,
  evidence?: string[],
) {
  if (!current) {
    if (next === "draft" && confidence >= 0.6 && frameHasDraftYoloEvidence(evidence)) return 2;
    return confidence >= 0.7 ? 2 : 3;
  }
  if (current === "draft" && next !== "draft") {
    if (next === "unknown") return 6;
    return 4;
  }
  if (next === "unknown") return 6;
  if (next === "loading") return 4;
  if (next === "draft") {
    if ((current === "unknown" || current === "loading") && confidence >= 0.6 && frameHasDraftYoloEvidence(evidence)) {
      return 2;
    }
    if (confidence >= 0.75) return 2;
    return 3;
  }
  return 3;
}

export function frameCanChallengeConfirmedState(frame: LiveVisionFrame, _current?: VisionScreenState | null) {
  return frame.screen === "unknown" || frame.screen === "loading" || frame.confidence >= 0.52;
}
