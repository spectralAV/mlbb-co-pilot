import type { GameEvent, GameState, GankRiskOutput, LaneId, LiveCoachingOutput, MapZoneId, ZoneStatus } from "./gameTypes";

type CoachingContext = {
  confidence: "low" | "medium" | "high";
  recentDeath?: GameEvent;
  recentReset?: GameEvent;
  recentFightWon?: GameEvent;
  recentFightLost?: GameEvent;
};

type CoachingScenario = {
  id: string;
  evaluate: (state: GameState, risk: GankRiskOutput, context: CoachingContext) => LiveCoachingOutput | null;
};

export function getLiveCoaching(state: GameState, risk: GankRiskOutput): LiveCoachingOutput {
  const context = buildContext(state);
  for (const scenario of coachingScenarios) {
    const result = scenario.evaluate(state, risk, context);
    if (result) return withScenario(scenario.id, result, context);
  }
  return withScenario("default_rotation", {
    mainAction: risk.recommendation.text,
    reason: risk.recommendation.confidence === "low" ? "Limited inputs + no urgent timer." : "No urgent timer + no critical lane.",
    warnings: limitWarnings(risk.warnings),
    priority: context.confidence === "low" ? "low" : "medium",
    mode: risk.recommendation.action === "reset" ? "reset" : risk.recommendation.action === "defend" ? "defend" : "rotate",
    secondaryActions: ["Update enemy locations.", "Move through controlled vision."],
    confidence: minConfidence(context.confidence, risk.recommendation.confidence)
  }, context);
}

const coachingScenarios: CoachingScenario[] = [
  {
    id: "death_review",
    evaluate: (state, risk, context) => {
      const deathActive = state.mode === "review" || Boolean(context.recentDeath && (!context.recentReset || context.recentDeath.timestamp > context.recentReset.timestamp));
      if (!deathActive) return null;
      return {
        mainAction: "Review map only until respawn.",
        reason: "You died + no reset logged.",
        warnings: limitWarnings(["Track enemy objective setup.", ...risk.warnings]),
        priority: "medium",
        mode: "reset",
        secondaryActions: ["Plan first safe camp or wave.", "Ping missing enemies if they show."],
        avoid: ["Calling live engages while dead."],
        confidence: "high"
      };
    }
  },
  {
    id: "base_defense",
    evaluate: (state, risk) => {
      const base = zoneStatus(state, "ally_base");
      if (!isDanger(base)) return null;
      return {
        mainAction: "Defend base before leaving map.",
        reason: "Base marked danger + wave unresolved.",
        warnings: limitWarnings(["Do not trade base for camps.", ...risk.warnings]),
        priority: "urgent",
        mode: "defend",
        secondaryActions: ["Recall safely.", "Clear the strongest wave first."],
        avoid: ["Starting Lord or Turtle while base wave is unresolved."],
        confidence: "high"
      };
    }
  },
  {
    id: "fight_lost_response",
    evaluate: (state, risk, context) => {
      if (!context.recentFightLost || context.recentFightWon && context.recentFightWon.timestamp > context.recentFightLost.timestamp) return null;
      const objective = nextMajorObjective(state);
      if (objective.seconds < 70 && canTradeObjective(state)) {
        return {
          mainAction: `Trade ${oppositeSideText(state)}. ${objective.label} setup is lost.`,
          reason: `${objective.label} in ${formatTimer(objective.seconds)} + fight lost.`,
          warnings: limitWarnings(["Do not re-enter river without numbers.", ...risk.warnings]),
          priority: "high",
          mode: "defend",
          secondaryActions: ["Clear mid wave first.", "Take the opposite tower or jungle only if safe."],
          confidence: minConfidence(inputConfidence(state), "medium")
        };
      }
      return {
        mainAction: state.goldState === "behind" ? "Defend waves and give river space." : "Reset now before the next fight.",
        reason: state.goldState === "behind" ? "Fight lost + team behind." : "Fight lost + numbers reset needed.",
        warnings: limitWarnings(["Avoid low-value revenge fights.", ...risk.warnings]),
        priority: state.goldState === "behind" ? "urgent" : "high",
        mode: state.goldState === "behind" ? "defend" : "reset",
        secondaryActions: ["Spend gold.", "Re-enter through mid or roam vision."],
        confidence: "high"
      };
    }
  },
  {
    id: "fight_won_conversion",
    evaluate: (state, risk, context) => {
      if (!context.recentFightWon || context.recentFightLost && context.recentFightLost.timestamp > context.recentFightWon.timestamp) return null;
      const objective = nextMajorObjective(state);
      const enemyBuff = nextEnemyBuff(state);
      if (objective.seconds < 70) {
        return {
          mainAction: `Convert fight into ${objective.label} control.`,
          reason: `${objective.label} in ${formatTimer(objective.seconds)} + enemy numbers down.`,
          warnings: limitWarnings(risk.warnings),
          priority: objective.seconds < 30 ? "urgent" : "high",
          mode: "objective",
          secondaryActions: ["Push mid first.", "Enter river with roam or tank vision."],
          confidence: "high"
        };
      }
      if (enemyBuff && canInvadeBuff(state, enemyBuff.lane)) {
        return {
          mainAction: `Invade enemy ${enemyBuff.name} after mid moves.`,
          reason: `Won fight + enemy ${enemyBuff.name} in ${formatTimer(enemyBuff.seconds)}.`,
          warnings: limitWarnings(risk.warnings),
          priority: "high",
          mode: "rotate",
          secondaryActions: ["Take one camp, then leave.", "Drop the invade if Mid cannot move."],
          confidence: "high"
        };
      }
      return {
        mainAction: "Push nearest wave, then take jungle.",
        reason: "Won fight + no immediate objective.",
        warnings: limitWarnings(risk.warnings),
        priority: "medium",
        mode: "rotate",
        secondaryActions: ["Crash wave before farming.", "Do not chase into dark jungle."],
        confidence: "medium"
      };
    }
  },
  {
    id: "low_information",
    evaluate: (state, risk, context) => {
      if (context.confidence !== "low") return null;
      return {
        mainAction: lowInfoAction(state),
        reason: "Low confidence + stale or unknown inputs.",
        warnings: limitWarnings(["Wait for enemy locations.", ...risk.warnings]),
        priority: "medium",
        mode: state.goldState === "behind" ? "defend" : "farm",
        secondaryActions: ["Update lane pressure.", "Mark enemy jungle or roam position."],
        avoid: ["Invading or starting objective from unknown info."],
        confidence: "low"
      };
    }
  },
  {
    id: "lord_setup",
    evaluate: (state, risk) => objectiveSetup(state, risk, "Lord", seconds(state.objectiveTimers.lord), 60)
  },
  {
    id: "turtle_setup",
    evaluate: (state, risk) => objectiveSetup(state, risk, "Turtle", seconds(state.objectiveTimers.turtle), 60)
  },
  {
    id: "ally_buff_secure",
    evaluate: (state, risk) => {
      if (state.role !== "jungle") return null;
      const buff = nextOwnBuff(state);
      if (!buff || buff.seconds >= 40) return null;
      return {
        mainAction: `Path back to own ${buff.name} safely.`,
        reason: `Own ${buff.name} in ${formatTimer(buff.seconds)} + ${laneName(buff.lane)} ${state.lanePressure[buff.lane]}.`,
        warnings: limitWarnings([state.enemyMissing.roam ? "Enemy roam missing near entrances." : "", ...risk.warnings]),
        priority: buff.seconds < 20 ? "high" : "medium",
        mode: "farm",
        secondaryActions: [`Ask ${laneName(buff.lane)} or Mid to cover entrance.`, "Leave if enemies collapse without priority."],
        avoid: ["Trading your buff for a low-percent gank."],
        confidence: inputConfidence(state)
      };
    }
  },
  {
    id: "enemy_buff_invade",
    evaluate: (state, risk) => {
      const buff = nextEnemyBuff(state);
      if (!buff || buff.seconds >= 40 || !canInvadeBuff(state, buff.lane)) return null;
      return {
        mainAction: `Invade enemy ${buff.name} with priority.`,
        reason: `Enemy ${buff.name} in ${formatTimer(buff.seconds)} + ${laneName(buff.lane)} can move.`,
        warnings: limitWarnings(risk.warnings),
        priority: "medium",
        mode: "rotate",
        secondaryActions: ["Move with Mid or Roam.", "Take one resource, then leave."],
        avoid: ["Chasing past the buff camp."],
        confidence: minConfidence(inputConfidence(state), "medium")
      };
    }
  },
  {
    id: "objective_pit_contested",
    evaluate: (state, risk) => {
      const pit = zoneStatus(state, "objective_pit");
      if (pit !== "contested" && pit !== "danger") return null;
      return {
        mainAction: "Do not walk into objective pit first.",
        reason: "Pit marked danger + vision not secured.",
        warnings: limitWarnings(risk.warnings),
        priority: "high",
        mode: "objective",
        secondaryActions: ["Clear mid wave.", "Enter with roam or tank vision."],
        avoid: ["Solo face-checking river."],
        confidence: "medium"
      };
    }
  },
  {
    id: "jungler_side_call",
    evaluate: (state, risk) => {
      const side = junglerMapSide(state);
      if (!side || !recentJunglerSeenEvent(state)) return null;
      const dangerLane: LaneId = side === "top" ? "exp" : "gold";
      const safeLane: LaneId = side === "top" ? "gold" : "exp";
      const dangerRisk = risk.lanes[dangerLane].risk;
      return {
        mainAction: state.role === "jungle"
          ? `Path ${laneName(safeLane)} side; warn ${laneName(dangerLane)}.`
          : `Hold safe wave; ${laneName(dangerLane)} is threatened.`,
        reason: `Enemy jungler ${side} side + ${laneName(dangerLane)} ${state.lanePressure[dangerLane]}.`,
        warnings: limitWarnings([`${laneName(dangerLane)} side needs caution.`, ...risk.warnings]),
        priority: dangerRisk === "critical" ? "urgent" : dangerRisk === "high" ? "high" : "medium",
        mode: state.role === "jungle" ? "farm" : "defend",
        secondaryActions: [`Avoid starting a low-value ${laneName(dangerLane)} play.`, `${laneName(safeLane)} side has lower immediate jungle threat.`],
        confidence: minConfidence(inputConfidence(state), "medium")
      };
    }
  },
  {
    id: "gold_lane_cover",
    evaluate: (state, risk) => laneCover(state, risk, "gold", "Counter-gank Gold only if Mid moves first.")
  },
  {
    id: "exp_lane_cover",
    evaluate: (state, risk) => laneCover(state, risk, "exp", "Hover EXP before the next wave crash.")
  },
  {
    id: "mid_priority_reset",
    evaluate: (state, risk) => {
      if (state.lanePressure.mid === "winning" || (!state.enemyMissing.mid && !state.enemyMissing.roam)) return null;
      return {
        mainAction: "Clear mid before rotating.",
        reason: `Mid ${state.lanePressure.mid} + ${state.enemyMissing.mid ? "Mid missing" : "Roam missing"}.`,
        warnings: limitWarnings(risk.warnings),
        priority: "medium",
        mode: "rotate",
        secondaryActions: ["Hold river entrance.", "Move only after the wave is fixed."],
        avoid: ["Invading without mid wave control."],
        confidence: minConfidence(inputConfidence(state), "medium")
      };
    }
  },
  {
    id: "behind_stabilize",
    evaluate: (state, risk) => {
      if (state.goldState !== "behind") return null;
      return {
        mainAction: "Farm safe camps and defend waves.",
        reason: "Team behind + low-info fights are risky.",
        warnings: limitWarnings(risk.warnings),
        priority: "medium",
        mode: "farm",
        secondaryActions: ["Clear waves near towers.", "Punish overextensions instead of starting fights."],
        avoid: ["River fights without vision."],
        confidence: minConfidence(inputConfidence(state), "medium")
      };
    }
  }
];

function objectiveSetup(state: GameState, risk: GankRiskOutput, label: "Turtle" | "Lord", timer: number, activeWindow: number): LiveCoachingOutput | null {
  if (timer >= activeWindow) return null;
  const pressure = objectivePressure(state);
  const confidence = minConfidence(inputConfidence(state), pressure.confidence);
  if (timer < 30) {
    const shouldTrade = state.goldState === "behind" || pressure.canStart === false;
    return {
      mainAction: shouldTrade ? `Trade side map. ${label} setup is unsafe.` : `Group now for ${label}.`,
      reason: `${label} in ${formatTimer(timer)} + Mid ${state.lanePressure.mid}.`,
      warnings: limitWarnings([shouldTrade ? "Avoid flipping objective from weak lanes." : "Do not take a low-value fight before spawn.", ...risk.warnings]),
      priority: shouldTrade ? "urgent" : "high",
      mode: "objective",
      secondaryActions: shouldTrade ? ["Push opposite wave.", "Defend mid entrance."] : ["Clear mid wave.", "Enter river together."],
      avoid: ["Solo face-checking river bushes."],
      confidence
    };
  }
  return {
    mainAction: label === "Turtle" && state.role === "jungle" ? "Clear red, then prepare Turtle river." : `Prepare ${label} river vision.`,
    reason: `${label} in ${formatTimer(timer)} + ${pressure.summary}.`,
    warnings: limitWarnings(["Avoid low-value fights before objective.", ...risk.warnings]),
    priority: state.goldState === "behind" || state.enemyMissing.mid || state.enemyMissing.roam ? "urgent" : "high",
    mode: "objective",
    secondaryActions: ["Fix mid wave.", "Check enemy jungler position."],
    avoid: ["Starting before Mid or Roam can enter."],
    confidence
  };
}

function laneCover(state: GameState, risk: GankRiskOutput, lane: LaneId, action: string): LiveCoachingOutput | null {
  const laneRisk = risk.lanes[lane];
  if (laneRisk.risk !== "critical" && laneRisk.risk !== "high") return null;
  if (state.lanePressure[lane] !== "losing" && laneRisk.risk !== "critical") return null;
  return {
    mainAction: action,
    reason: laneRisk.reasons[0] ?? `${laneName(lane)} lane exposed.`,
    warnings: limitWarnings(risk.warnings),
    priority: laneRisk.risk === "critical" ? "urgent" : "high",
    mode: "defend",
    secondaryActions: [`Hover ${laneName(lane)} entrance.`, "Counter-gank before starting a cross-map play."],
    avoid: ["Showing on the opposite side too early."],
    confidence: minConfidence(inputConfidence(state), "high")
  };
}

function buildContext(state: GameState): CoachingContext {
  return {
    confidence: inputConfidence(state),
    recentDeath: latestEvent(state, "death"),
    recentReset: latestEventByLabel(state, "reset", "recall", "respawn"),
    recentFightWon: recentEvent(state, "fight_won", 45_000),
    recentFightLost: recentEvent(state, "fight_lost", 45_000)
  };
}

function inputConfidence(state: GameState): "low" | "medium" | "high" {
  let score = 3;
  const unknownLanes = Object.values(state.lanePressure).filter((pressure) => pressure === "unknown").length;
  if (unknownLanes >= 2) score -= 2;
  else if (unknownLanes === 1) score -= 1;
  const hasActionableTimer = Object.values(state.objectiveTimers).some((timer) => typeof timer === "number" && timer < 180);
  if (!hasActionableTimer) score -= 1;
  const hasEnemyInfo = state.enemyMissing.jungler || state.enemyMissing.mid || state.enemyMissing.roam || Boolean(state.lastEnemySeen.jungler || state.lastEnemySeen.mid || state.lastEnemySeen.roam);
  if (!hasEnemyInfo && state.events.length === 0) score -= 1;
  if (state.cv?.connected && (state.cv.confidence === "low" || state.cv.stale || (state.cv.screenType === "live_hud" && !state.cv.minimapRecognized))) score -= 1;
  if (state.cv?.connected && state.cv.visibleEnemies > 0 && state.cv.minimapRecognized) score += 1;
  return score <= 1 ? "low" : score === 2 ? "medium" : "high";
}

function nextMajorObjective(state: GameState) {
  const turtle = seconds(state.objectiveTimers.turtle);
  const lord = seconds(state.objectiveTimers.lord);
  return lord < turtle ? { label: "Lord" as const, seconds: lord } : { label: "Turtle" as const, seconds: turtle };
}

function objectivePressure(state: GameState) {
  const mid = state.lanePressure.mid;
  const sideLanes: LaneId[] = ["exp", "gold"];
  const winningSides = sideLanes.filter((lane) => state.lanePressure[lane] === "winning").length;
  const losingSides = sideLanes.filter((lane) => state.lanePressure[lane] === "losing").length;
  const unknownSides = sideLanes.filter((lane) => state.lanePressure[lane] === "unknown").length;
  return {
    canStart: mid === "winning" && losingSides === 0,
    summary: mid === "winning" && winningSides > 0 ? "Mid and side priority" : mid === "even" ? "Mid even" : `${mid === "unknown" ? "Mid unknown" : "Mid losing"}`,
    confidence: unknownSides || mid === "unknown" ? "low" as const : "high" as const
  };
}

function nextOwnBuff(state: GameState) {
  const blue = seconds(state.objectiveTimers.allyBlue);
  const red = seconds(state.objectiveTimers.allyRed);
  const next = blue <= red
    ? { name: "blue", seconds: blue, lane: "exp" as LaneId }
    : { name: "red", seconds: red, lane: "gold" as LaneId };
  return next.seconds < 999 ? next : null;
}

function nextEnemyBuff(state: GameState) {
  const blue = seconds(state.objectiveTimers.enemyBlue);
  const red = seconds(state.objectiveTimers.enemyRed);
  const next = blue <= red
    ? { name: "blue", seconds: blue, lane: "exp" as LaneId }
    : { name: "red", seconds: red, lane: "gold" as LaneId };
  return next.seconds < 999 ? next : null;
}

function canInvadeBuff(state: GameState, nearbyLane: LaneId) {
  if (state.enemyMissing.mid || state.enemyMissing.roam) return false;
  return state.goldState === "ahead" && (state.lanePressure.mid === "winning" || state.lanePressure[nearbyLane] === "winning");
}

function junglerMapSide(state: GameState): "top" | "bot" | null {
  const zone = state.lastEnemySeen.jungler;
  if (zone === "river_exp" || zone === "exp_lane" || zone === "enemy_blue" || zone === "ally_blue") return "top";
  if (zone === "river_gold" || zone === "gold_lane" || zone === "enemy_red" || zone === "ally_red") return "bot";
  return null;
}

function canTradeObjective(state: GameState) {
  return state.lanePressure.exp === "winning" || state.lanePressure.gold === "winning" || state.goldState === "ahead";
}

function oppositeSideText(state: GameState) {
  if (state.lanePressure.exp === "winning") return "top tower";
  if (state.lanePressure.gold === "winning") return "Gold-side tower";
  return "opposite wave";
}

function lowInfoAction(state: GameState) {
  if (state.goldState === "behind") return "Defend waves until enemy positions show.";
  if (state.role === "jungle") return "Farm near safe side and wait for info.";
  return "Hold safe wave and wait for info.";
}

function seconds(value: number | undefined) {
  return value ?? 999;
}

function formatTimer(value: number) {
  const safe = Math.max(0, value);
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, "0")}`;
}

function laneName(lane: LaneId) {
  return lane === "exp" ? "EXP" : lane === "mid" ? "Mid" : "Gold";
}

function latestEvent(state: GameState, type: GameEvent["type"]) {
  return state.events.find((event) => event.type === type);
}

function latestEventByLabel(state: GameState, ...fragments: string[]) {
  return state.events.find((event) => fragments.some((fragment) => event.label.toLowerCase().includes(fragment)));
}

function recentEvent(state: GameState, type: GameEvent["type"], maxAgeMs: number) {
  const event = latestEvent(state, type);
  return event && Date.now() - event.timestamp <= maxAgeMs ? event : undefined;
}

function recentJunglerSeenEvent(state: GameState) {
  const event = recentEvent(state, "enemy_seen", 60_000);
  return event?.label.toLowerCase().includes("jungler") ? event : undefined;
}

function zoneStatus(state: GameState, zone: MapZoneId): ZoneStatus {
  return state.mapZones.find((item) => item.id === zone)?.status ?? "unknown";
}

function isDanger(status: ZoneStatus) {
  return status === "danger" || status === "contested";
}

function limitWarnings(warnings: string[]) {
  return warnings.filter(Boolean).slice(0, 3);
}

function minConfidence(...values: Array<"low" | "medium" | "high" | undefined>): "low" | "medium" | "high" {
  const score = { low: 1, medium: 2, high: 3 };
  const clean = values.filter(Boolean) as Array<"low" | "medium" | "high">;
  return clean.reduce((lowest, value) => score[value] < score[lowest] ? value : lowest, "high");
}

function withScenario(scenarioId: string, output: LiveCoachingOutput, context: CoachingContext): LiveCoachingOutput {
  return {
    scenarioId,
    secondaryActions: [],
    avoid: [],
    ...output,
    confidence: output.confidence ?? context.confidence,
    warnings: limitWarnings(output.warnings)
  };
}
