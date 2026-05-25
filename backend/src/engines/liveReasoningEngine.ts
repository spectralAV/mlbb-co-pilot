import { eventBus } from "../event-bus/eventBus.js";

export type ReasoningScene = "main" | "map" | "text" | "counter" | "picks";
export type ReasoningPriority = "low" | "medium" | "high";

export type LiveReasoningInput = {
  frameId?: string;
  source?: string;
  timestamp?: number;
  screen?: string;
  confidence?: number;
  minimapMarkers?: Array<{ side?: string; confidence?: number }>;
  signals?: {
    objectiveSoon?: boolean;
    objectiveName?: string;
    objectiveSpawnsInSec?: number;
    missingEnemyCount?: number;
    missingEnemies?: string[];
    riverVision?: boolean;
    warning?: string;
    teamHasAntiHeal?: boolean;
    enemyHealingThreats?: string[];
    enemyItems?: string[];
  };
};

export type LiveReasoningOutput = {
  sourceFrameId: string;
  source: string;
  timestamp: number;
  scene: ReasoningScene;
  priority: ReasoningPriority;
  callout: string;
  reason: string;
  recommendedAction: string;
  confidence: number;
  ruleId: string;
  itemAdjustment?: string;
  observation: {
    screen: string;
    missingEnemyCount?: number;
    missingEnemies: string[];
    objectiveName?: string;
    objectiveSpawnsInSec?: number;
    objectiveSoon: boolean;
    riverVision?: boolean;
    enemyMarkerCount: number;
    healingThreats: string[];
  };
  updatedAt: string;
};

let latest: LiveReasoningOutput | null = null;

export function ingestLiveReasoning(input: LiveReasoningInput) {
  latest = evaluateLiveReasoning(input);
  eventBus.emit("reasoning_updated", latest);
  return latest;
}

export function getLatestLiveReasoning() {
  return latest;
}

export function evaluateLiveReasoning(input: LiveReasoningInput): LiveReasoningOutput {
  const signals = input.signals ?? {};
  const screen = String(input.screen ?? "unknown");
  const confidence = clamp01(input.confidence);
  const enemyMarkerCount = (input.minimapMarkers ?? []).filter((marker) => marker.side === "enemy" && clamp01(marker.confidence) >= 0.45).length;
  const missingEnemies = toStringArray(signals.missingEnemies);
  const missingEnemyCount = finiteOptional(signals.missingEnemyCount) ?? (missingEnemies.length || undefined);
  const objectiveSpawnsInSec = finiteOptional(signals.objectiveSpawnsInSec);
  const objectiveSoon = Boolean(signals.objectiveSoon) || (objectiveSpawnsInSec !== undefined && objectiveSpawnsInSec <= 60);
  const objectiveName = signals.objectiveName ? String(signals.objectiveName) : objectiveSoon ? "Objective" : undefined;
  const healingThreats = toStringArray(signals.enemyHealingThreats);
  const observation = {
    screen,
    missingEnemyCount,
    missingEnemies,
    objectiveName,
    objectiveSpawnsInSec,
    objectiveSoon,
    riverVision: typeof signals.riverVision === "boolean" ? signals.riverVision : undefined,
    enemyMarkerCount,
    healingThreats
  };
  const base = {
    sourceFrameId: String(input.frameId ?? `reasoning-${Date.now()}`),
    source: String(input.source ?? "live-observation"),
    timestamp: finiteOptional(input.timestamp) ?? Date.now(),
    confidence,
    observation,
    updatedAt: new Date().toISOString()
  };

  if (confidence < 0.45 || screen === "unknown") {
    return decision(base, "main", "low", "No reliable live callout.", "Visual confidence is too low for a tactical decision.", "Wait for clearer detected state.", "confidence_gate");
  }

  if (screen === "draft" || screen === "loading") {
    return decision(base, "picks", "medium", "Draft state detected.", "Hero recognition can drive pick and counter analysis.", "Track confirmed picks before recommending.", "draft_state");
  }

  if (screen === "death_replay") {
    return decision(base, "text", "medium", "Reset the map after respawn.", "Death or replay state detected during live play.", "Re-establish lanes and objective vision.", "death_reset");
  }

  if (signals.warning) {
    return decision(base, "text", "high", String(signals.warning), "A validated warning signal was received.", "Respect the warning before committing.", "explicit_warning");
  }

  if (healingThreats.length && signals.teamHasAntiHeal === false) {
    const threats = healingThreats.slice(0, 2).join(" and ");
    return {
      ...decision(base, "text", "high", "Anti-heal required.", `${threats} detected with no allied anti-heal confirmed.`, "Prioritize an anti-heal item before the next fight.", "anti_heal_gap"),
      itemAdjustment: "Anti-heal item required"
    };
  }

  if (objectiveSoon && (missingEnemyCount ?? 0) >= 3 && signals.riverVision === false) {
    const objective = objectiveName ?? "Objective";
    return decision(base, "map", "high", `${objective} soon: do not start blind.`, "Three or more enemies are missing and river vision is absent.", "Secure river vision before committing.", "objective_blind_risk");
  }

  if ((missingEnemyCount ?? 0) >= 3) {
    return decision(base, "counter", "high", `${missingEnemyCount} enemies missing.`, "Multiple enemy positions are unconfirmed.", "Avoid face-checking and hold safe vision.", "missing_enemies");
  }

  if (objectiveSoon) {
    const objective = objectiveName ?? "Objective";
    return decision(base, "map", "high", `${objective} setup now.`, "An objective timing window is approaching.", "Clear waves and establish river control.", "objective_setup");
  }

  if (screen === "live_hud" && enemyMarkerCount > 0) {
    return decision(base, "map", "medium", "Enemy map activity detected.", "Minimap markers were recognized in live play.", "Track rotations before forcing a fight.", "minimap_activity");
  }

  if (screen === "scoreboard" || screen === "item_shop") {
    return decision(base, "main", "low", "Review detected builds.", "Build information is visible but no urgent counter-rule fired.", "Wait for validated item counters.", "build_review");
  }

  return decision(base, "main", "low", "Map state stable.", "No urgent deterministic rule fired.", "Continue tracking enemies and objectives.", "stable_state");
}

function decision(
  base: Omit<LiveReasoningOutput, "scene" | "priority" | "callout" | "reason" | "recommendedAction" | "ruleId">,
  scene: ReasoningScene,
  priority: ReasoningPriority,
  callout: string,
  reason: string,
  recommendedAction: string,
  ruleId: string
): LiveReasoningOutput {
  return { ...base, scene, priority, callout, reason, recommendedAction, ruleId };
}

function toStringArray(value: unknown) {
  return Array.isArray(value) ? value.map(String).map((item) => item.trim()).filter(Boolean).slice(0, 10) : [];
}

function finiteOptional(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function clamp01(value: unknown) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.min(1, number));
}
