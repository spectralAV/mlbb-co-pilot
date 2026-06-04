import {
  ADVISORY_MACRO_NOTE_SLOTS,
  ADVISORY_RECOMMENDATION_SLOTS,
  ADVISORY_COACH_CONFIG,
  type AdvisoryCoach,
  type AdvisoryCoachInput,
  type AdvisoryCoachOutput,
  type AdvisoryRecommendation,
} from "./advisoryCoach.js";
import { heuristicAdvisoryCoach } from "./heuristicAdvisoryCoach.js";

const SIDECAR_TIMEOUT_MS = Number(process.env.ADVISORY_SIDECAR_TIMEOUT_MS ?? 5000);

function trimList<T>(items: T[] | undefined, max: number): T[] {
  return Array.isArray(items) ? items.slice(0, max) : [];
}

function normalizeOutput(
  raw: unknown,
  input: AdvisoryCoachInput,
  fallbackError?: string,
): AdvisoryCoachOutput | null {
  if (!raw || typeof raw !== "object") return null;
  const payload = raw as Record<string, unknown>;
  const data = (payload.data && typeof payload.data === "object" ? payload.data : payload) as Record<string, unknown>;
  const groundedRuleId = String(data.groundedRuleId ?? "");
  if (groundedRuleId !== input.decision.ruleId) return null;

  const recommendations = trimList(data.recommendations as AdvisoryRecommendation[], ADVISORY_RECOMMENDATION_SLOTS)
    .filter((entry) => entry && typeof entry.id === "string" && typeof entry.title === "string" && typeof entry.action === "string");
  const macroNotes = trimList(data.macroNotes as string[], ADVISORY_MACRO_NOTE_SLOTS)
    .filter((entry) => typeof entry === "string" && entry.trim());

  return {
    status: data.status === "skipped" ? "skipped" : "ready",
    advisorId: String(data.advisorId ?? "llm-sidecar-v1"),
    groundedRuleId,
    reasoning: String(data.reasoning ?? "").slice(0, 1200),
    recommendations,
    macroNotes,
    updatedAt: new Date().toISOString(),
    ...(typeof data.error === "string" && data.error ? { error: data.error } : {}),
  };
}

async function postSidecar(input: AdvisoryCoachInput): Promise<AdvisoryCoachOutput | null> {
  const url = ADVISORY_COACH_CONFIG.sidecarUrl?.trim();
  if (!url) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SIDECAR_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ context: input.context, decision: input.decision }),
      signal: controller.signal,
    });
    if (!response.ok) return null;
    const json = await response.json();
    return normalizeOutput(json, input);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export const llmSidecarAdvisoryCoach: AdvisoryCoach = {
  id: "llm-sidecar-v1",
  async evaluate(input) {
    const sidecar = await postSidecar(input);
    if (sidecar) return sidecar;

    const fallback = await heuristicAdvisoryCoach.evaluate(input);
    return {
      ...fallback,
      advisorId: "llm-sidecar-v1",
      reasoning: fallback.reasoning
        ? `${fallback.reasoning} (sidecar unavailable; heuristic fallback)`
        : "Sidecar unavailable; heuristic fallback.",
      ...(sidecar === null && ADVISORY_COACH_CONFIG.sidecarUrl
        ? { error: "Sidecar request failed or returned invalid payload." }
        : {}),
    };
  },
};

export async function probeAdvisorySidecarHealth() {
  const base = ADVISORY_COACH_CONFIG.sidecarUrl?.trim();
  if (!base) {
    return { ok: false, reachable: false, error: "ADVISORY_SIDECAR_URL is not set." };
  }
  let healthUrl: string;
  try {
    const parsed = new URL(base);
    parsed.pathname = "/health";
    parsed.search = "";
    healthUrl = parsed.toString();
  } catch {
    return { ok: false, reachable: false, error: "ADVISORY_SIDECAR_URL is invalid." };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3000);
  try {
    const response = await fetch(healthUrl, { signal: controller.signal });
    const body = await response.json().catch(() => ({}));
    return { ok: response.ok, reachable: true, status: response.status, body };
  } catch (error) {
    return {
      ok: false,
      reachable: false,
      error: error instanceof Error ? error.message : "Sidecar health check failed.",
    };
  } finally {
    clearTimeout(timer);
  }
}
