import type { GameEvent, GameSession, GankRiskOutput, LaneId, LiveCoachingOutput, MapZoneId, Risk } from "./gameTypes";

export const lanes: LaneId[] = ["exp", "mid", "gold"];
export const riskRank: Record<Risk, number> = { low: 1, medium: 2, high: 3, critical: 4 };
export const riskMeterScore: Record<Risk, number> = { low: 22, medium: 48, high: 74, critical: 94 };
export const laneLabels: Record<LaneId, string> = { exp: "EXP", mid: "Mid", gold: "Gold" };
export const zoneLabels: Record<MapZoneId, string> = {
  ally_base: "Ally Base",
  enemy_base: "Enemy Base",
  exp_lane: "EXP Lane",
  mid_lane: "Mid Lane",
  gold_lane: "Gold Lane",
  ally_blue: "Ally Blue",
  ally_red: "Ally Red",
  enemy_blue: "Enemy Blue",
  enemy_red: "Enemy Red",
  river_exp: "EXP River",
  river_gold: "Gold River",
  objective_pit: "Turtle/Lord"
};

const validRisks: Risk[] = ["low", "medium", "high", "critical"];
const validCoachingPriorities: LiveCoachingOutput["priority"][] = ["low", "medium", "high", "urgent"];
const defaultLaneRisk = { risk: "low" as Risk, reasons: ["No current risk signal."] };
const defaultRecommendation: GankRiskOutput["recommendation"] = {
  action: "farm",
  text: "Farm safely and update enemy locations.",
  confidence: "medium"
};

export function normalizeRisk(value: unknown, fallback: Risk = "low"): Risk {
  return validRisks.includes(value as Risk) ? value as Risk : fallback;
}

function normalizeCoachingPriority(value: unknown): LiveCoachingOutput["priority"] {
  return validCoachingPriorities.includes(value as LiveCoachingOutput["priority"]) ? value as LiveCoachingOutput["priority"] : "low";
}

export function normalizeGankRisk(risk: GankRiskOutput | null | undefined): GankRiskOutput {
  const recommendation = risk?.recommendation ?? defaultRecommendation;
  return {
    lanes: {
      exp: normalizeLaneRisk(risk?.lanes?.exp),
      mid: normalizeLaneRisk(risk?.lanes?.mid),
      gold: normalizeLaneRisk(risk?.lanes?.gold)
    },
    mapZones: (risk?.mapZones ?? []).map((zone) => ({
      zone: zone.zone,
      risk: normalizeRisk(zone.risk, "medium"),
      reason: zone.reason || "Map pressure signal."
    })),
    recommendation: {
      ...defaultRecommendation,
      ...recommendation,
      text: recommendation.text || defaultRecommendation.text,
      confidence: recommendation.confidence ?? "medium"
    },
    warnings: Array.isArray(risk?.warnings) ? risk.warnings.filter(Boolean).slice(0, 3) : []
  };
}

function normalizeLaneRisk(laneRisk: GankRiskOutput["lanes"][LaneId] | undefined) {
  return {
    risk: normalizeRisk(laneRisk?.risk),
    reasons: laneRisk?.reasons?.length ? laneRisk.reasons.filter(Boolean).slice(0, 3) : defaultLaneRisk.reasons
  };
}

export function highestRiskLane(risk: GankRiskOutput | null | undefined) {
  const normalized = normalizeGankRisk(risk);
  return lanes
    .map((lane) => ({ lane, ...normalized.lanes[lane] }))
    .sort((a, b) => riskRank[b.risk] - riskRank[a.risk])[0];
}

export function normalizeCoaching(coaching: LiveCoachingOutput | null | undefined): LiveCoachingOutput {
  return {
    mainAction: coaching?.mainAction || "Hold safe position.",
    reason: coaching?.reason || "Waiting for enough live context.",
    warnings: Array.isArray(coaching?.warnings) ? coaching.warnings.filter(Boolean).slice(0, 3) : [],
    priority: normalizeCoachingPriority(coaching?.priority),
    mode: coaching?.mode ?? "farm",
    scenarioId: coaching?.scenarioId,
    secondaryActions: coaching?.secondaryActions ?? [],
    avoid: coaching?.avoid ?? [],
    confidence: coaching?.confidence ?? "medium"
  };
}

export function safeSessionEvents(session: GameSession | null | undefined): GameEvent[] {
  return Array.isArray(session?.events) ? session.events : [];
}

export function safeSessionNotes(session: GameSession | null | undefined): string[] {
  return Array.isArray(session?.notes) ? session.notes : [];
}

export function eventRisk(event: GameEvent): Risk {
  if (event.type === "death" || event.type === "fight_lost") return "critical";
  if (event.type === "enemy_missing" || event.type === "objective_taken") return "high";
  if (event.type === "summoner_spell_down" || event.type === "ultimate_down") return "medium";
  return "low";
}
