import type { GameState, GankRiskOutput, LaneId, MapZoneId, Risk } from "./gameTypes";

const riskScore: Record<Risk, number> = { low: 1, medium: 2, high: 3, critical: 4 };
const scoreRisk = (score: number): Risk => score >= 5 ? "critical" : score >= 3 ? "high" : score >= 2 ? "medium" : "low";

function laneRisk(state: GameState, lane: LaneId): { risk: Risk; reasons: string[] } {
  let score = 1;
  const reasons: string[] = [];
  const pressure = state.lanePressure[lane];
  const junglerSide = junglerMapSide(state);
  const cvZoneRisk = state.cv?.estimatedEnemyZones?.some((zone) => laneZoneMatches(lane, zone)) ?? false;
  const cvBlind = Boolean(state.cv?.connected && state.cv.screenType === "live_hud" && !state.cv.minimapRecognized);

  if (pressure === "losing") {
    score += 2;
    reasons.push(`${laneLabel(lane)} lane is losing`);
  } else if (pressure === "even") {
    score += 1;
    reasons.push(`${laneLabel(lane)} lane has no clear priority`);
  } else if (pressure === "unknown") {
    score += 1;
    reasons.push(`${laneLabel(lane)} pressure unknown`);
  }

  if (state.enemyMissing.roam) {
    score += pressure === "losing" ? 2 : 1;
    reasons.push("Enemy roam missing");
  }

  if (state.enemyMissing.mid) {
    score += lane === "mid" ? 2 : 1;
    reasons.push(lane === "mid" ? "Enemy mid missing" : "Mid missing can move side");
  }

  if (state.enemyMissing.jungler && !junglerSide) {
    score += lane === "mid" ? 0 : 1;
    reasons.push("Enemy jungler unseen");
  }

  if (cvZoneRisk) {
    score += 1;
    reasons.push("CV enemy estimate nearby");
  }

  if (cvBlind && pressure !== "winning") {
    score += 1;
    reasons.push("CV minimap uncertain");
  }

  if (junglerSide === "top") {
    if (lane === "exp") {
      score += 2;
      reasons.push("Enemy jungler top side");
    } else if (lane === "mid") {
      score += 1;
      reasons.push("Enemy jungler near top river");
    }
  }

  if (junglerSide === "bot") {
    if (lane === "gold") {
      score += 2;
      reasons.push("Enemy jungler bot side");
    } else if (lane === "mid") {
      score += 1;
      reasons.push("Enemy jungler near bot river");
    }
  }

  if (!reasons.length) reasons.push(`${laneLabel(lane)} lane currently stable`);
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
  const junglerSide = junglerMapSide(state);

  if (junglerSide === "top") {
    pushZone(mapZones, "river_exp", "high", "Enemy jungler top side");
    pushZone(mapZones, "exp_lane", lanes.exp.risk, "Top-side gank threat");
    warnings.push("EXP/top side needs caution.");
  }
  if (junglerSide === "bot") {
    pushZone(mapZones, "river_gold", "high", "Enemy jungler bot side");
    pushZone(mapZones, "gold_lane", lanes.gold.risk, "Gold-side gank threat");
    warnings.push("Gold/bot side needs caution.");
  }
  if (state.enemyMissing.roam) {
    pushZone(mapZones, "river_exp", "high", "Roam missing");
    pushZone(mapZones, "river_gold", "high", "Roam missing");
    warnings.push("Enemy roam missing.");
  }
  if (state.enemyMissing.mid) {
    pushZone(mapZones, "mid_lane", "high", "Mid missing");
    pushZone(mapZones, "river_exp", "high", "Mid can move side");
    pushZone(mapZones, "river_gold", "high", "Mid can move side");
    warnings.push("Enemy mid missing.");
  }
  if (state.cv?.connected && state.cv.screenType === "live_hud" && !state.cv.minimapRecognized) {
    pushZone(mapZones, "river_exp", "medium", "CV minimap uncertain");
    pushZone(mapZones, "river_gold", "medium", "CV minimap uncertain");
    warnings.push("CV minimap confidence is low.");
  }
  for (const zone of state.cv?.estimatedEnemyZones ?? []) {
    pushZone(mapZones, zone, "high", "High-confidence CV enemy estimate");
  }
  if ((state.objectiveTimers.turtle ?? 999) < 60) {
    pushZone(mapZones, "objective_pit", state.enemyMissing.mid || state.enemyMissing.roam ? "critical" : "high", "Turtle timing is close");
    warnings.push("Prepare river vision before Turtle.");
  }
  if ((state.objectiveTimers.lord ?? 999) < 60) {
    pushZone(mapZones, "objective_pit", state.goldState === "behind" ? "critical" : "high", "Lord timing is close");
    warnings.push("Prepare Lord river before spawn.");
  }
  for (const lane of ["exp", "mid", "gold"] as LaneId[]) {
    if (riskScore[lanes[lane].risk] >= 3) {
      pushZone(mapZones, lane === "exp" ? "exp_lane" : lane === "mid" ? "mid_lane" : "gold_lane", lanes[lane].risk, lanes[lane].reasons[0] ?? `${laneLabel(lane)} pressure`);
    }
  }

  const highestLane = (Object.entries(lanes) as [LaneId, { risk: Risk; reasons: string[] }][])
    .sort((a, b) => riskScore[b[1].risk] - riskScore[a[1].risk])[0];
  const recommendation = buildRecommendation(state, highestLane);

  return { lanes, mapZones: dedupeZones(mapZones).slice(0, 6), recommendation, warnings: warnings.filter(Boolean).slice(0, 3) };
}

function buildRecommendation(state: GameState, highestLane: [LaneId, { risk: Risk; reasons: string[] }]): GankRiskOutput["recommendation"] {
  const turtle = state.objectiveTimers.turtle ?? 999;
  const lord = state.objectiveTimers.lord ?? 999;
  const objective = lord < turtle ? { label: "Lord", seconds: lord } : { label: "Turtle", seconds: turtle };
  if (state.mode === "review") {
    return { action: "reset", text: "Watch map only until respawn.", confidence: "high" };
  }
  if (objective.seconds < 30) {
    const canGroup = state.lanePressure.mid === "winning" && state.goldState !== "behind";
    return {
      action: canGroup ? "group" : "trade",
      targetZone: "objective_pit",
      text: canGroup ? `Group now for ${objective.label}.` : `Trade map. ${objective.label} setup is unsafe.`,
      confidence: state.lanePressure.mid === "unknown" ? "low" : "high"
    };
  }
  if (objective.seconds < 60) {
    return {
      action: "group",
      targetZone: "objective_pit",
      text: `Prepare ${objective.label} river vision.`,
      confidence: state.lanePressure.mid === "unknown" ? "low" : "high"
    };
  }
  if (highestLane[1].risk === "critical") {
    return {
      action: "counter_gank",
      targetZone: laneToZone(highestLane[0]),
      text: `Counter-gank ${laneLabel(highestLane[0])} only if Mid moves first.`,
      confidence: "high"
    };
  }
  if (state.goldState === "behind") {
    return { action: "defend", text: "Defend waves and avoid low-info fights.", confidence: "medium" };
  }
  if (Object.values(state.lanePressure).filter((pressure) => pressure === "unknown").length >= 2) {
    return { action: "farm", text: "Farm near safe side and wait for information.", confidence: "low" };
  }
  return {
    action: "farm",
    targetZone: state.role === "jungle" ? "ally_red" : undefined,
    text: "Farm safe side and update enemy locations.",
    confidence: "medium"
  };
}

function junglerMapSide(state: GameState): "top" | "bot" | null {
  const zone = state.lastEnemySeen.jungler;
  if (zone === "river_exp" || zone === "exp_lane" || zone === "enemy_blue" || zone === "ally_blue") return "top";
  if (zone === "river_gold" || zone === "gold_lane" || zone === "enemy_red" || zone === "ally_red") return "bot";
  return null;
}

function pushZone(mapZones: GankRiskOutput["mapZones"], zone: MapZoneId, risk: Risk, reason: string) {
  mapZones.push({ zone, risk, reason });
}

function dedupeZones(zones: GankRiskOutput["mapZones"]) {
  const byZone = new Map<MapZoneId, { zone: MapZoneId; risk: Risk; reason: string }>();
  for (const zone of zones) {
    const existing = byZone.get(zone.zone);
    if (!existing || riskScore[zone.risk] > riskScore[existing.risk]) byZone.set(zone.zone, zone);
  }
  return [...byZone.values()].sort((a, b) => riskScore[b.risk] - riskScore[a.risk]);
}

function laneToZone(lane: LaneId): MapZoneId {
  return lane === "exp" ? "exp_lane" : lane === "mid" ? "mid_lane" : "gold_lane";
}

function laneZoneMatches(lane: LaneId, zone: MapZoneId) {
  if (lane === "exp") return zone === "exp_lane" || zone === "river_exp" || zone === "ally_blue" || zone === "enemy_blue";
  if (lane === "gold") return zone === "gold_lane" || zone === "river_gold" || zone === "ally_red" || zone === "enemy_red";
  return zone === "mid_lane" || zone === "objective_pit";
}

function laneLabel(lane: LaneId) {
  return lane === "exp" ? "EXP" : lane === "mid" ? "Mid" : "Gold";
}
