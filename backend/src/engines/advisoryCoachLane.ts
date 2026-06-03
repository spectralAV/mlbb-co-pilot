import { eventBus } from "../event-bus/eventBus.js";
import {
  ADVISORY_COACH_CONFIG,
  type AdvisoryCoach,
  type AdvisoryCoachOutput,
} from "./advisoryCoach.js";
import type { LiveReasoningInput, LiveReasoningOutput } from "./liveReasoningEngine.js";
import { heuristicAdvisoryCoach } from "./heuristicAdvisoryCoach.js";
import { updateMatchAdvisory } from "../state/matchState.js";

let latestAdvisory: AdvisoryCoachOutput | null = null;
let lastRunAt = 0;
let inFlight = false;

function resolveAdvisor(): AdvisoryCoach {
  if (ADVISORY_COACH_CONFIG.provider === "llm-sidecar") {
    return heuristicAdvisoryCoach;
  }
  return heuristicAdvisoryCoach;
}

function objectiveKey(output: LiveReasoningOutput) {
  const obs = output.observation;
  return `${obs.objectiveName ?? ""}:${obs.objectiveSoon}:${obs.objectiveActive}`;
}

export function shouldTriggerAdvisory(prev: LiveReasoningOutput | null, next: LiveReasoningOutput): boolean {
  if (!ADVISORY_COACH_CONFIG.enabled) return false;
  if (!prev) return true;
  if (prev.ruleId !== next.ruleId) return true;
  if (prev.priority !== next.priority) return true;
  const pObs = prev.observation;
  const nObs = next.observation;
  if (pObs.phase !== nObs.phase) return true;
  if (pObs.goldState !== nObs.goldState && nObs.goldState !== "unknown") return true;
  if (objectiveKey(prev) !== objectiveKey(next)) return true;
  if ((pObs.deadEnemies ?? 0) !== (nObs.deadEnemies ?? 0)) return true;
  if ((pObs.deadAllies ?? 0) !== (nObs.deadAllies ?? 0)) return true;
  return false;
}

export function getLatestAdvisoryCoach() {
  return latestAdvisory;
}

export async function runAdvisoryCoach(
  context: LiveReasoningInput,
  decision: LiveReasoningOutput,
): Promise<AdvisoryCoachOutput> {
  const advisor = resolveAdvisor();
  try {
    return await advisor.evaluate({ context, decision });
  } catch (error) {
    return {
      status: "error",
      advisorId: advisor.id,
      groundedRuleId: decision.ruleId,
      reasoning: "",
      recommendations: [],
      macroNotes: [],
      updatedAt: new Date().toISOString(),
      error: error instanceof Error ? error.message : "Advisory coach failed",
    };
  }
}

function publishAdvisory(output: AdvisoryCoachOutput) {
  latestAdvisory = output;
  updateMatchAdvisory(output);
  eventBus.emit("advisory_updated", output);
}

export function scheduleAdvisoryFromReasoning(
  context: LiveReasoningInput,
  decision: LiveReasoningOutput,
  previous: LiveReasoningOutput | null = null,
) {
  if (!ADVISORY_COACH_CONFIG.enabled) return;
  const now = Date.now();
  const meaningful = shouldTriggerAdvisory(previous, decision);
  const intervalOk = now - lastRunAt >= ADVISORY_COACH_CONFIG.minIntervalMs;
  if (!meaningful && !intervalOk) return;
  if (inFlight) return;

  inFlight = true;
  void runAdvisoryCoach(context, decision)
    .then((output) => {
      lastRunAt = Date.now();
      publishAdvisory(output);
    })
    .catch((error) => {
      publishAdvisory({
        status: "error",
        advisorId: "heuristic-stub-v1",
        groundedRuleId: decision.ruleId,
        reasoning: "",
        recommendations: [],
        macroNotes: [],
        updatedAt: new Date().toISOString(),
        error: error instanceof Error ? error.message : "Advisory lane error",
      });
    })
    .finally(() => {
      inFlight = false;
    });
}

/** Test hook: run advisory synchronously without throttle. */
export async function evaluateAdvisoryForTest(
  context: LiveReasoningInput,
  decision: LiveReasoningOutput,
) {
  const output = await runAdvisoryCoach(context, decision);
  publishAdvisory(output);
  return output;
}
