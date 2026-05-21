import type { GameState, GankRiskOutput, LaneId, Risk } from "./gameTypes";

const riskScore: Record<Risk, number> = { low: 1, medium: 2, high: 3, critical: 4 };
const scoreRisk = (score: number): Risk => score >= 4 ? "critical" : score >= 3 ? "high" : score >= 2 ? "medium" : "low";

function laneRisk(state: GameState, lane: LaneId): { risk: Risk; reasons: string[] } {
  let score = 1;
  const reasons: string[] = [];
  const pressure = state.lanePressure[lane];

  if (pressure === "losing") {
    score += 2;
    reasons.push(`${lane.toUpperCase()} lane is losing`);
  } else if (pressure === "even") {
    score += 1;
    reasons.push(`${lane.toUpperCase()} lane has no clear priority`);
  }

  if (state.enemyMissing.roam) {
    score += lane === "gold" ? 2 : 1;
    reasons.push("Enemy roam missing");
  }
  if (state.enemyMissing.jungler) {
    score += lane === "gold" || lane === "exp" ? 1 : 0;
    reasons.push("Enemy jungler unseen");
  }
  if (state.lastEnemySeen.jungler === "river_exp" && lane === "exp") {
    score += 1;
    reasons.push("Enemy jungler last seen top river");
  }
  if (state.lastEnemySeen.jungler === "river_gold" && lane === "gold") {
    score += 1;
    reasons.push("Enemy jungler last seen gold river");
  }

  return { risk: scoreRisk(score), reasons: reasons.slice(0, 3) };
}

export function analyzeGankRisk(state: GameState): GankRiskOutput {
  const lanes = {
    exp: laneRisk(state, "exp"),
    mid: laneRisk(state, "mid"),
    gold: laneRisk(state, "gold")
  };
  const warnings: string[] = [];
  const mapZones: GankRiskOutput["mapZones"] = [];

  if ((state.objectiveTimers.turtle ?? 999) < 45) {
    mapZones.push({ zone: "objective_pit", risk: state.enemyMissing.mid ? "critical" : "high", reason: "Turtle spawning soon" });
    warnings.push("Prepare river vision before Turtle.");
  }
  if ((state.objectiveTimers.lord ?? 999) < 60) {
    mapZones.push({ zone: "objective_pit", risk: state.goldState === "behind" ? "critical" : "high", reason: "Lord timing is close" });
  }
  if (state.enemyMissing.roam) warnings.push("Enemy roam missing.");
  if (riskScore[lanes.gold.risk] >= 3) warnings.push("Gold lane gank risk is high.");

  const highestLane = (Object.entries(lanes) as [LaneId, { risk: Risk; reasons: string[] }][]).sort((a, b) => riskScore[b[1].risk] - riskScore[a[1].risk])[0];
  let recommendation: GankRiskOutput["recommendation"] = {
    action: "farm",
    targetZone: state.role === "jungle" ? "ally_red" : undefined,
    text: "Farm safely and update enemy locations.",
    confidence: "medium"
  };

  if ((state.objectiveTimers.turtle ?? 999) < 45) {
    recommendation = {
      action: state.enemyMissing.mid || state.enemyMissing.roam ? "group" : "gank",
      targetZone: "objective_pit",
      text: state.enemyMissing.mid || state.enemyMissing.roam ? "Group near Turtle river, but do not face-check." : "Move toward Turtle river after your next clear.",
      confidence: "high"
    };
  } else if (highestLane[1].risk === "critical") {
    recommendation = {
      action: "counter_gank",
      targetZone: highestLane[0] === "gold" ? "gold_lane" : highestLane[0] === "exp" ? "exp_lane" : "mid_lane",
      text: `Cover ${highestLane[0].toUpperCase()} lane before forcing elsewhere.`,
      confidence: "high"
    };
  } else if (state.goldState === "behind") {
    recommendation = { action: "defend", text: "Defend waves and avoid low-info fights.", confidence: "medium" };
  }

  return { lanes, mapZones, recommendation, warnings: warnings.slice(0, 3) };
}
