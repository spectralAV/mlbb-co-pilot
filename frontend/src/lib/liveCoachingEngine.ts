import type { GameState, GankRiskOutput, LiveCoachingOutput } from "./gameTypes";

export function getLiveCoaching(state: GameState, risk: GankRiskOutput): LiveCoachingOutput {
  const turtle = state.objectiveTimers.turtle ?? 999;
  const lord = state.objectiveTimers.lord ?? 999;

  if (turtle < 45) {
    return {
      mainAction: "Clear red side, then move to Turtle river.",
      reason: `Turtle spawns in ${turtle}s and mid lane is ${state.lanePressure.mid}.`,
      warnings: risk.warnings.slice(0, 3),
      priority: "high",
      mode: "objective"
    };
  }

  if (lord < 60) {
    return {
      mainAction: state.goldState === "behind" ? "Defend vision and clear waves before Lord." : "Push side lane, then group for Lord.",
      reason: `Lord spawns in ${lord}s.`,
      warnings: risk.warnings.slice(0, 3),
      priority: state.goldState === "behind" ? "urgent" : "high",
      mode: "objective"
    };
  }

  if (risk.lanes.gold.risk === "critical") {
    return {
      mainAction: "Cover Gold lane. Do not force river alone.",
      reason: "Gold lane is losing while enemy roam or jungler is missing.",
      warnings: risk.warnings.slice(0, 3),
      priority: "urgent",
      mode: "defend"
    };
  }

  if (state.goldState === "behind") {
    return {
      mainAction: "Farm safe camps and defend the next wave.",
      reason: "Your team is behind and low-info fights are risky.",
      warnings: risk.warnings.slice(0, 3),
      priority: "medium",
      mode: "farm"
    };
  }

  return {
    mainAction: risk.recommendation.text,
    reason: "No urgent objective is spawning, so map information decides the next move.",
    warnings: risk.warnings.slice(0, 3),
    priority: "medium",
    mode: "rotate"
  };
}
