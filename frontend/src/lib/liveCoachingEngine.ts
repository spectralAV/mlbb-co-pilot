import type { GameState, GankRiskOutput, LaneId, LiveCoachingOutput, MapZoneId, ZoneStatus } from "./gameTypes";

type CoachingScenario = {
  id: string;
  evaluate: (state: GameState, risk: GankRiskOutput) => LiveCoachingOutput | null;
};

export function getLiveCoaching(state: GameState, risk: GankRiskOutput): LiveCoachingOutput {
  for (const scenario of coachingScenarios) {
    const result = scenario.evaluate(state, risk);
    if (result) return { scenarioId: scenario.id, confidence: result.confidence ?? "medium", ...result };
  }
  return withScenario("default_rotation", {
    mainAction: risk.recommendation.text,
    reason: "No urgent objective, defense, lane, reset, or resource rule is active.",
    warnings: risk.warnings.slice(0, 3),
    priority: "medium",
    mode: "rotate",
    secondaryActions: ["Update enemy locations.", "Move through controlled vision."],
    confidence: risk.recommendation.confidence
  });
}

const coachingScenarios: CoachingScenario[] = [
  {
    id: "base_defense",
    evaluate: (state, risk) => {
      const base = zoneStatus(state, "ally_base");
      if (!isDanger(base)) return null;
      return withScenario("base_defense", {
        mainAction: "Defend base before leaving the map.",
        reason: "Ally base pressure is marked as dangerous or contested.",
        warnings: ["Do not trade base for camps.", ...risk.warnings].slice(0, 3),
        priority: "urgent",
        mode: "defend",
        secondaryActions: ["Recall safely.", "Clear the strongest wave first."],
        avoid: ["Starting Lord or Turtle while base wave is unresolved."],
        confidence: "high"
      });
    }
  },
  {
    id: "lord_setup",
    evaluate: (state, risk) => {
      const lord = state.objectiveTimers.lord ?? 999;
      if (lord >= 60) return null;
      const behind = state.goldState === "behind";
      return withScenario("lord_setup", {
        mainAction: behind ? "Defend vision and clear waves before Lord." : "Push side lane, then group for Lord.",
        reason: `Lord spawns in ${lord}s and your team is ${state.goldState}.`,
        warnings: risk.warnings.slice(0, 3),
        priority: behind ? "urgent" : "high",
        mode: "objective",
        secondaryActions: behind
          ? ["Hold mid wave.", "Trade opposite side if river is dark."]
          : ["Crash side wave.", "Arrive before enemy vision settles."],
        avoid: behind ? ["Blind face-checks into river bushes."] : [],
        confidence: "high"
      });
    }
  },
  {
    id: "turtle_setup",
    evaluate: (state, risk) => {
      const turtle = state.objectiveTimers.turtle ?? 999;
      if (turtle >= 45) return null;
      const noMidPriority = state.lanePressure.mid !== "winning";
      const missingThreat = state.enemyMissing.mid || state.enemyMissing.roam;
      return withScenario("turtle_setup", {
        mainAction: missingThreat || noMidPriority ? "Set Turtle river vision before starting." : "Clear red side, then move to Turtle river.",
        reason: `Turtle spawns in ${turtle}s and mid lane is ${state.lanePressure.mid}.`,
        warnings: risk.warnings.slice(0, 3),
        priority: missingThreat ? "urgent" : "high",
        mode: "objective",
        secondaryActions: ["Clear mid wave.", "Check enemy jungler position."],
        avoid: missingThreat ? ["Starting Turtle while mid or roam is unseen."] : [],
        confidence: "high"
      });
    }
  },
  {
    id: "objective_pit_contested",
    evaluate: (state, risk) => {
      const pit = zoneStatus(state, "objective_pit");
      if (pit !== "contested" && pit !== "danger") return null;
      return withScenario("objective_pit_contested", {
        mainAction: "Do not walk into objective pit first.",
        reason: "The objective area is marked contested or dangerous.",
        warnings: risk.warnings.slice(0, 3),
        priority: "high",
        mode: "objective",
        secondaryActions: ["Clear mid wave.", "Enter with roam or tank vision."],
        avoid: ["Solo face-checking river."],
        confidence: "medium"
      });
    }
  },
  {
    id: "gold_lane_cover",
    evaluate: (state, risk) => laneCover(state, risk, "gold", "Cover Gold lane. Do not force river alone.")
  },
  {
    id: "exp_lane_cover",
    evaluate: (state, risk) => laneCover(state, risk, "exp", "Cover EXP lane before the next wave crash.")
  },
  {
    id: "mid_priority_reset",
    evaluate: (state, risk) => {
      if (state.lanePressure.mid === "winning" || (!state.enemyMissing.mid && !state.enemyMissing.roam)) return null;
      return withScenario("mid_priority_reset", {
        mainAction: "Clear mid before rotating.",
        reason: "Mid has no clear priority while enemy mid or roam is missing.",
        warnings: risk.warnings.slice(0, 3),
        priority: "medium",
        mode: "rotate",
        secondaryActions: ["Hold river entrance.", "Move only after the wave is fixed."],
        avoid: ["Invading without mid wave control."],
        confidence: "medium"
      });
    }
  },
  {
    id: "ally_buff_secure",
    evaluate: (state, risk) => {
      if (state.role !== "jungle") return null;
      const blue = state.objectiveTimers.allyBlue ?? 999;
      const red = state.objectiveTimers.allyRed ?? 999;
      const next = Math.min(blue, red);
      if (next >= 25) return null;
      const buff = blue <= red ? "blue" : "red";
      return withScenario("ally_buff_secure", {
        mainAction: `Secure ally ${buff} buff on spawn.`,
        reason: `Your ${buff} buff respawns in ${next}s.`,
        warnings: risk.warnings.slice(0, 3),
        priority: "medium",
        mode: "farm",
        secondaryActions: ["Ask nearby lane to cover entrance.", "Leave if enemies collapse without priority."],
        confidence: "medium"
      });
    }
  },
  {
    id: "enemy_buff_invade",
    evaluate: (state, risk) => {
      if (state.goldState !== "ahead") return null;
      const blue = state.objectiveTimers.enemyBlue ?? 999;
      const red = state.objectiveTimers.enemyRed ?? 999;
      const next = Math.min(blue, red);
      if (next >= 40 || state.enemyMissing.roam || state.enemyMissing.mid) return null;
      const buff = blue <= red ? "blue" : "red";
      return withScenario("enemy_buff_invade", {
        mainAction: `Invade enemy ${buff} with lane priority.`,
        reason: `Enemy ${buff} buff timing is close and your team is ahead.`,
        warnings: risk.warnings.slice(0, 3),
        priority: "medium",
        mode: "rotate",
        secondaryActions: ["Move with mid or roam.", "Take one resource, then leave."],
        avoid: ["Chasing past the buff camp."],
        confidence: "medium"
      });
    }
  },
  {
    id: "behind_stabilize",
    evaluate: (state, risk) => {
      if (state.goldState !== "behind") return null;
      return withScenario("behind_stabilize", {
        mainAction: "Farm safe camps and defend the next wave.",
        reason: "Your team is behind and low-info fights are risky.",
        warnings: risk.warnings.slice(0, 3),
        priority: "medium",
        mode: "farm",
        secondaryActions: ["Clear waves near towers.", "Punish overextensions instead of starting fights."],
        avoid: ["River fights without vision."],
        confidence: "medium"
      });
    }
  }
];

function laneCover(state: GameState, risk: GankRiskOutput, lane: LaneId, action: string): LiveCoachingOutput | null {
  const laneRisk = risk.lanes[lane];
  if (laneRisk.risk !== "critical" && laneRisk.risk !== "high") return null;
  if (state.lanePressure[lane] !== "losing" && laneRisk.risk !== "critical") return null;
  return withScenario(`${lane}_lane_cover`, {
    mainAction: action,
    reason: laneRisk.reasons[0] ?? `${lane.toUpperCase()} lane is exposed.`,
    warnings: risk.warnings.slice(0, 3),
    priority: laneRisk.risk === "critical" ? "urgent" : "high",
    mode: "defend",
    secondaryActions: [`Hover ${lane.toUpperCase()} lane entrance.`, "Counter-gank before starting a cross-map play."],
    avoid: ["Showing on the opposite side too early."],
    confidence: "high"
  });
}

function zoneStatus(state: GameState, zone: MapZoneId): ZoneStatus {
  return state.mapZones.find((item) => item.id === zone)?.status ?? "unknown";
}

function isDanger(status: ZoneStatus) {
  return status === "danger" || status === "contested";
}

function withScenario(scenarioId: string, output: LiveCoachingOutput): LiveCoachingOutput {
  return {
    scenarioId,
    secondaryActions: [],
    avoid: [],
    confidence: "medium",
    ...output
  };
}
