import {
  ADVISORY_MACRO_NOTE_SLOTS,
  ADVISORY_RECOMMENDATION_SLOTS,
  type AdvisoryCoach,
  type AdvisoryCoachInput,
  type AdvisoryCoachOutput,
  type AdvisoryRecommendation,
} from "./advisoryCoach.js";

function slot(id: string, title: string, action: string, horizon: AdvisoryRecommendation["horizon"]): AdvisoryRecommendation {
  return { id, title, action, horizon };
}

function macroForRule(ruleId: string, phase: string, role: string): string[] {
  const notes: string[] = [];
  if (ruleId.startsWith("objective_") || ruleId === "lord_late_priority" || ruleId === "turtle_early_setup") {
    notes.push("Anchor vision on river entrances 30s before commit.");
  }
  if (phase === "late") notes.push("Late game: one bad fight loses structure — group on timers.");
  if (role === "jungle") notes.push("Track enemy Retribution before starting burst on Lord/Turtle.");
  if (role === "roam") notes.push("Sweep bush on rotation path; ping missing before leaving lane.");
  return notes.slice(0, ADVISORY_MACRO_NOTE_SLOTS);
}

function recommendationsFor(input: AdvisoryCoachInput): AdvisoryRecommendation[] {
  const { decision } = input;
  const obs = decision.observation;
  const role = obs.role ?? "unknown";
  const phase = obs.phase ?? "unknown";
  const list: AdvisoryRecommendation[] = [];

  list.push(slot(
    "primary",
    "Fast lane call",
    decision.recommendedAction,
    "immediate",
  ));

  const ruleId = decision.ruleId;
  if (ruleId.includes("objective") || ruleId === "lord_late_priority" || ruleId === "turtle_early_setup") {
    list.push(slot("obj-setup", "Objective setup", "Clear mid wave, then place vision on nearest river bush.", "short"));
    if (obs.missingEnemyCount !== undefined && obs.missingEnemyCount >= 2) {
      list.push(slot("obj-info", "Information", "Confirm jungler/roam position before committing Retribution.", "short"));
    }
  } else if (ruleId.includes("missing") || ruleId === "all_enemies_missing") {
    list.push(slot("vision", "Safety", "Play with wave; only face-check with ally numbers.", "immediate"));
    list.push(slot("track", "Tracking", "Note last-seen lane and rotate one camp early to match spawn.", "mid"));
  } else if (ruleId === "numbers_advantage_force" || ruleId === "ultimate_ready_engage") {
    list.push(slot("convert", "Conversion", "Take nearest outer turret or enemy jungle quadrant within 15s.", "short"));
    list.push(slot("reset", "Reset plan", "If fight stalls, reset waves instead of chasing into fog.", "mid"));
  } else if (ruleId === "behind_safe_farm" || ruleId === "defensive_warding_behind") {
    list.push(slot("stabilize", "Stabilize", "Catch side waves under tower; concede outer camps if contested.", "short"));
    list.push(slot("pick", "Comeback", "Look for pick on overextended carry before contesting Lord.", "mid"));
  } else if (ruleId === "anti_heal_gap") {
    list.push(slot("item", "Item plan", "Finish anti-heal before grouping; ping team to delay all-in.", "short"));
  } else if (ruleId === "roam_gank_setup" || ruleId === "mid_rotation_winning") {
    list.push(slot("gank", "Rotation", "Path through river with wave advantage; do not sit in bush without timer.", "short"));
  } else if (ruleId === "draft_state") {
    list.push(slot("draft", "Draft plan", "Confirm lane assignments and level-one path before loading finishes.", "mid"));
  } else {
    list.push(slot("macro", "Default macro", "Track objective timer and sync recall with next item spike.", "mid"));
  }

  if (phase === "early" && role !== "jungle") {
    list.push(slot("early", "Early game", "Hit level 4 before river skirmish; respect first Turtle timing.", "mid"));
  }

  return list.slice(0, ADVISORY_RECOMMENDATION_SLOTS);
}

function reasoningText(input: AdvisoryCoachInput): string {
  const { decision } = input;
  const alt = decision.alternatives?.[0];
  const parts = [
    `Grounded on ${decision.ruleId}: ${decision.reason}`,
    decision.nextActions?.length ? `Next: ${decision.nextActions.slice(0, 2).join("; ")}` : "",
    alt ? `Also considered ${alt.ruleId} (${alt.callout}).` : "",
  ].filter(Boolean);
  return parts.join(" ").slice(0, 480);
}

export const heuristicAdvisoryCoach: AdvisoryCoach = {
  id: "heuristic-stub-v1",
  async evaluate(input: AdvisoryCoachInput): Promise<AdvisoryCoachOutput> {
    const { decision } = input;
    if (decision.ruleId === "confidence_gate" || decision.ruleId === "lobby_idle") {
      return {
        status: "skipped",
        advisorId: "heuristic-stub-v1",
        groundedRuleId: decision.ruleId,
        reasoning: "Advisory skipped while fast lane has no tactical context.",
        recommendations: [],
        macroNotes: [],
        updatedAt: new Date().toISOString(),
      };
    }
    const obs = decision.observation;
    return {
      status: "ready",
      advisorId: "heuristic-stub-v1",
      groundedRuleId: decision.ruleId,
      reasoning: reasoningText(input),
      recommendations: recommendationsFor(input),
      macroNotes: macroForRule(decision.ruleId, String(obs.phase), String(obs.role)),
      updatedAt: new Date().toISOString(),
    };
  },
};
