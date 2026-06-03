import type { LiveReasoningInput, LiveReasoningOutput } from "./liveReasoningEngine.js";

/** Max structured recommendation slots returned by any advisor implementation. */
export const ADVISORY_RECOMMENDATION_SLOTS = 3 as const;
export const ADVISORY_MACRO_NOTE_SLOTS = 2 as const;

export type AdvisoryHorizon = "immediate" | "short" | "mid";

export type AdvisoryRecommendation = {
  id: string;
  title: string;
  action: string;
  horizon: AdvisoryHorizon;
};

export type AdvisoryCoachOutput = {
  status: "ready" | "skipped" | "error";
  advisorId: string;
  groundedRuleId: string;
  reasoning: string;
  recommendations: AdvisoryRecommendation[];
  macroNotes: string[];
  updatedAt: string;
  error?: string;
};

export type AdvisoryCoachInput = {
  context: LiveReasoningInput;
  decision: LiveReasoningOutput;
};

/**
 * System 2 advisory coach. Implementations must ground on `decision` and never contradict
 * the fast-lane ruleId/callout. Future LLM/NPU sidecars implement this interface.
 */
export interface AdvisoryCoach {
  readonly id: string;
  evaluate(input: AdvisoryCoachInput): Promise<AdvisoryCoachOutput>;
}

/**
 * Runtime config. Set `provider` to `llm-sidecar` and `sidecarUrl` when a Python/native
 * sidecar is attached (AMD Vitis AI / Intel OpenVINO / Qualcomm QNN / DML+CPU fallback).
 */
export const ADVISORY_COACH_CONFIG = {
  enabled: process.env.ADVISORY_COACH_ENABLED !== "false",
  provider: (process.env.ADVISORY_COACH_PROVIDER ?? "heuristic-stub") as "heuristic-stub" | "llm-sidecar",
  minIntervalMs: Number(process.env.ADVISORY_COACH_MIN_MS ?? 8000),
  sidecarUrl: process.env.ADVISORY_SIDECAR_URL ?? "",
};
