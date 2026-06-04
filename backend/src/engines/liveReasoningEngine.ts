import { eventBus } from "../event-bus/eventBus.js";
import { scheduleAdvisoryFromReasoning } from "./advisoryCoachLane.js";
import { DETECTED_FACT_CONFIDENCE } from "../state/matchState.js";

export type ReasoningScene = "main" | "map" | "text" | "counter" | "picks";
export type ReasoningPriority = "low" | "medium" | "high";
export type CoachScenarioCategory =
  | "lifecycle"
  | "draft"
  | "objective"
  | "map"
  | "lane"
  | "items"
  | "fight"
  | "tempo"
  | "defense";

type LaneId = "exp" | "mid" | "gold";
type LanePressure = "winning" | "even" | "losing" | "unknown";
type GoldState = "ahead" | "even" | "behind" | "unknown";
type MatchPhase = "early" | "mid" | "late" | "unknown";

type TimerFactLike = {
  timerType?: string;
  seconds?: number;
  value?: number;
  confidence?: number;
  source?: string;
};

type MapMonitorLike = {
  visibleAllies?: number;
  visibleEnemies?: number;
  lastSeenEnemies?: number;
  visibleObjectives?: string[];
  markers?: Array<{
    side?: string;
    status?: string;
    heroName?: string;
    confidence?: number;
    ageMs?: number;
  }>;
};

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
    objectiveActive?: boolean;
    missingEnemyCount?: number;
    missingEnemies?: string[];
    riverVision?: boolean;
    warning?: string;
    teamHasAntiHeal?: boolean;
    enemyHealingThreats?: string[];
    enemyItems?: string[];
    allyItems?: string[];
    enemyEquipment?: unknown[];
    allyEquipment?: unknown[];
    mapMonitor?: MapMonitorLike;
    timerFacts?: TimerFactLike[];
    phase?: string;
    matchTimeSeconds?: number;
    role?: string;
    selectedHero?: string;
    goldState?: string;
    goldLead?: number;
    lanePressure?: Partial<Record<LaneId, string>>;
    laneToPressure?: string;
    lowHealth?: boolean;
    needReset?: boolean;
    unspentGold?: number;
    powerSpikeReady?: boolean;
    ultimateReady?: boolean;
    alliesNearby?: number;
    enemiesNearby?: number;
    deadAllies?: number;
    deadEnemies?: number;
    allyDeadCount?: number;
    enemyDeadCount?: number;
    allyRespawns?: number[];
    enemyRespawns?: number[];
    allyRespawnInSec?: number;
    enemyRespawnInSec?: number;
    baseUnderAttack?: boolean;
    turretUnderThreat?: boolean;
    splitPushThreat?: boolean;
    enemyLordPush?: boolean;
    lordEnhancedMinions?: boolean;
    invadeWindow?: boolean;
    buffThreat?: string;
    waveState?: string;
    enemyRetributionReady?: boolean;
    teamHasRetribution?: boolean;
  };
};

export type ReasoningAlternative = {
  ruleId: string;
  scenarioId: string;
  category: CoachScenarioCategory;
  priority: ReasoningPriority;
  callout: string;
  recommendedAction: string;
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
  modelVersion: string;
  scenario: {
    id: string;
    category: CoachScenarioCategory;
    tags: string[];
  };
  nextActions: string[];
  warnings: string[];
  evidence: string[];
  alternatives: ReasoningAlternative[];
  observation: {
    screen: string;
    phase: MatchPhase;
    role: string;
    goldState: GoldState;
    missingEnemyCount?: number;
    missingEnemies: string[];
    objectiveName?: string;
    objectiveSpawnsInSec?: number;
    objectiveSoon: boolean;
    objectiveActive: boolean;
    riverVision?: boolean;
    enemyMarkerCount: number;
    visibleEnemies: number;
    lastSeenEnemies: number;
    visibleAllies: number;
    deadAllies: number;
    deadEnemies: number;
    healingThreats: string[];
    enemyItems: string[];
    allyItems: string[];
    lanePressure: Record<LaneId, LanePressure>;
  };
  updatedAt: string;
};

type ReasoningContext = {
  input: LiveReasoningInput;
  signals: NonNullable<LiveReasoningInput["signals"]>;
  screen: string;
  confidence: number;
  enemyMarkerCount: number;
  allyMarkerCount: number;
  visibleEnemies: number;
  visibleAllies: number;
  lastSeenEnemies: number;
  missingEnemies: string[];
  missingEnemyCount?: number;
  objectiveName?: string;
  objectiveSpawnsInSec?: number;
  objectiveSoon: boolean;
  objectiveActive: boolean;
  visibleObjectives: string[];
  riverVision?: boolean;
  healingThreats: string[];
  teamHasAntiHeal?: boolean;
  enemyItems: string[];
  allyItems: string[];
  timerFacts: TimerFactLike[];
  phase: MatchPhase;
  role: string;
  goldState: GoldState;
  lanePressure: Record<LaneId, LanePressure>;
  laneToPressure?: LaneId;
  lowHealth: boolean;
  needReset: boolean;
  unspentGold: number;
  powerSpikeReady: boolean;
  ultimateReady: boolean;
  alliesNearby: number;
  enemiesNearby: number;
  deadAllies: number;
  deadEnemies: number;
  allyRespawns: number[];
  enemyRespawns: number[];
  baseUnderAttack: boolean;
  turretUnderThreat: boolean;
  splitPushThreat: boolean;
  enemyLordPush: boolean;
  lordEnhancedMinions: boolean;
  invadeWindow: boolean;
  buffThreat?: string;
  waveState?: string;
};

type ScenarioMatch = {
  ruleId: string;
  scenarioId: string;
  category: CoachScenarioCategory;
  scene: ReasoningScene;
  priority: ReasoningPriority;
  callout: string;
  reason: string;
  recommendedAction: string;
  itemAdjustment?: string;
  tags: string[];
  nextActions?: string[];
  warnings?: string[];
  evidence?: string[];
  confidence?: number;
};

type ScenarioRule = {
  id: string;
  category: CoachScenarioCategory;
  tags: string[];
  description: string;
  evaluate: (ctx: ReasoningContext) => ScenarioMatch | null;
};

export const LIVE_REASONING_MODEL_VERSION = "coach-scenario-v2";

let latest: LiveReasoningOutput | null = null;

export function ingestLiveReasoning(input: LiveReasoningInput) {
  const previous = latest;
  latest = evaluateLiveReasoning(input);
  if (latest.ruleId !== previous?.ruleId) {
    console.info(JSON.stringify({
      event: "coach_rule",
      ruleId: latest.ruleId,
      previousRuleId: previous?.ruleId ?? null,
      screen: input.screen,
    }));
  }
  eventBus.emit("reasoning_updated", latest);
  scheduleAdvisoryFromReasoning(input, latest, previous);
  return latest;
}

export function getLatestLiveReasoning() {
  return latest;
}

export function listCoachReasoningScenarios() {
  return scenarioRules.map(({ id, category, tags, description }) => ({ id, category, tags, description }));
}

export function evaluateLiveReasoning(input: LiveReasoningInput): LiveReasoningOutput {
  const ctx = buildContext(input);
  const base = buildBase(input, ctx);
  const matches = scenarioRules
    .map((rule) => rule.evaluate(ctx))
    .filter((match): match is ScenarioMatch => Boolean(match));
  const primary = matches[0] ?? stableScenario(ctx);
  return decision(base, primary, matches.slice(1, 4));
}

const scenarioRules: ScenarioRule[] = [
  {
    id: "confidence_gate",
    category: "lifecycle",
    tags: ["vision", "safety", "fallback"],
    description: "Suppress tactical calls when the detected screen or frame confidence is not reliable.",
    evaluate: (ctx) => {
      if (ctx.confidence >= 0.45 && ctx.screen !== "unknown") return null;
      return scenario(ctx, {
        ruleId: "confidence_gate",
        category: "lifecycle",
        scene: "main",
        priority: "low",
        callout: "No reliable live callout.",
        reason: "Visual confidence is too low for a tactical decision.",
        recommendedAction: "Wait for clearer detected state.",
        tags: ["vision", "fallback"],
        evidence: [`screen=${ctx.screen}`, `confidence=${ctx.confidence.toFixed(2)}`],
      });
    },
  },
  {
    id: "lobby_idle",
    category: "lifecycle",
    tags: ["lobby", "setup"],
    description: "Keep the coach quiet while the player is not in a draft or live match.",
    evaluate: (ctx) => {
      if (ctx.screen !== "lobby") return null;
      return scenario(ctx, {
        ruleId: "lobby_idle",
        category: "lifecycle",
        scene: "main",
        priority: "low",
        callout: "Waiting for match context.",
        reason: "Lobby screen detected, so no tactical match state is active.",
        recommendedAction: "Start draft or live capture before asking for a match call.",
        tags: ["lobby"],
      });
    },
  },
  {
    id: "draft_state",
    category: "draft",
    tags: ["draft", "picks", "loading"],
    description: "Route draft and loading screens to pick, counter, spell, and game-plan reasoning.",
    evaluate: (ctx) => {
      if (ctx.screen !== "draft" && ctx.screen !== "loading") return null;
      return scenario(ctx, {
        ruleId: "draft_state",
        category: "draft",
        scene: "picks",
        priority: "medium",
        callout: ctx.screen === "loading" ? "Loading screen: lock the level-one plan." : "Draft state detected.",
        reason: ctx.screen === "loading"
          ? "Hero identities are mostly fixed; the coach should shift from picking to opening path and lane assignments."
          : "Hero recognition can drive pick and counter analysis.",
        recommendedAction: ctx.screen === "loading"
          ? "Check lanes, battle spells, invade risk, and first objective path."
          : "Track confirmed picks before recommending.",
        tags: ["draft", ctx.screen],
      });
    },
  },
  {
    id: "death_reset",
    category: "tempo",
    tags: ["death", "reset", "map"],
    description: "After a death, rebuild map information before issuing aggressive calls.",
    evaluate: (ctx) => {
      if (ctx.screen !== "death_replay") return null;
      return scenario(ctx, {
        ruleId: "death_reset",
        category: "tempo",
        scene: "text",
        priority: "medium",
        callout: "Reset the map after respawn.",
        reason: "Death or replay state detected during live play.",
        recommendedAction: "Re-establish lanes and objective vision.",
        tags: ["death", "reset"],
      });
    },
  },
  {
    id: "explicit_warning",
    category: "lifecycle",
    tags: ["manual", "warning"],
    description: "Trusted warning signals override normal scenario scoring.",
    evaluate: (ctx) => {
      if (!ctx.signals.warning) return null;
      return scenario(ctx, {
        ruleId: "explicit_warning",
        category: "lifecycle",
        scene: "text",
        priority: "high",
        callout: String(ctx.signals.warning),
        reason: "A validated warning signal was received.",
        recommendedAction: "Respect the warning before committing.",
        tags: ["explicit-warning"],
      });
    },
  },
  {
    id: "base_under_attack",
    category: "defense",
    tags: ["base", "lord", "late-game", "defense"],
    description: "Prioritize base defense, Lord minion defense, and inhibitor protection over map plays.",
    evaluate: (ctx) => {
      if (!ctx.baseUnderAttack && !ctx.enemyLordPush && !ctx.lordEnhancedMinions) return null;
      return scenario(ctx, {
        ruleId: "base_under_attack",
        category: "defense",
        scene: "main",
        priority: "high",
        callout: ctx.enemyLordPush || ctx.lordEnhancedMinions ? "Defend Lord wave first." : "Base is under threat.",
        reason: ctx.enemyLordPush || ctx.lordEnhancedMinions
          ? "Enhanced minions or a Lord push can end the game faster than a side objective."
          : "Core or inhibitor pressure is the most urgent map state.",
        recommendedAction: "Recall, clear the strongest wave, and avoid starting a fight outside base.",
        tags: ["defense", "base"],
        warnings: ["Do not trade base for jungle camps."],
      });
    },
  },
  {
    id: "lost_fight_disengage",
    category: "fight",
    tags: ["numbers", "disengage", "death-timers"],
    description: "Avoid follow-up fights when allied deaths create a clear numbers disadvantage.",
    evaluate: (ctx) => {
      if (ctx.deadAllies < 2 || ctx.deadAllies <= ctx.deadEnemies) return null;
      return scenario(ctx, {
        ruleId: "lost_fight_disengage",
        category: "fight",
        scene: "text",
        priority: "high",
        callout: "Numbers down: stop the chase.",
        reason: `${ctx.deadAllies} allies are down while only ${ctx.deadEnemies} enemies are down.`,
        recommendedAction: "Give space, clear waves, and wait for respawns before contesting.",
        tags: ["numbers-down", "death-timers"],
        evidence: [`deadAllies=${ctx.deadAllies}`, `deadEnemies=${ctx.deadEnemies}`],
      });
    },
  },
  {
    id: "numbers_advantage_force",
    category: "fight",
    tags: ["numbers", "pick", "objective"],
    description: "Convert enemy deaths into objective pressure, turret damage, or controlled invasion.",
    evaluate: (ctx) => {
      if (ctx.deadEnemies < 2 || ctx.deadEnemies <= ctx.deadAllies) return null;
      const action = ctx.objectiveActive || ctx.objectiveSoon
        ? "Secure vision and start the objective with zone control."
        : "Push the nearest wave, hit turret, or invade with your team.";
      return scenario(ctx, {
        ruleId: "numbers_advantage_force",
        category: "fight",
        scene: ctx.objectiveActive || ctx.objectiveSoon ? "map" : "main",
        priority: "high",
        callout: "Numbers advantage: take space now.",
        reason: `${ctx.deadEnemies} enemies are down and the map can be converted safely.`,
        recommendedAction: action,
        tags: ["numbers-up", "conversion"],
        evidence: [`deadEnemies=${ctx.deadEnemies}`, `deadAllies=${ctx.deadAllies}`],
      });
    },
  },
  {
    id: "anti_heal_gap",
    category: "items",
    tags: ["items", "anti-heal", "counter-build"],
    description: "Call for anti-heal when sustain threats are detected and allied anti-heal is missing.",
    evaluate: (ctx) => {
      if (!ctx.healingThreats.length || ctx.teamHasAntiHeal !== false) return null;
      const threats = ctx.healingThreats.slice(0, 2).join(" and ");
      return scenario(ctx, {
        ruleId: "anti_heal_gap",
        category: "items",
        scene: "text",
        priority: "high",
        callout: "Anti-heal required.",
        reason: `${threats} detected with no allied anti-heal confirmed.`,
        recommendedAction: "Prioritize an anti-heal item before the next fight.",
        itemAdjustment: "Anti-heal item required",
        tags: ["anti-heal", "counter-build"],
        nextActions: ["Buy Dominance Ice, Sea Halberd, or Glowing Wand based on role.", "Delay all-in fights until anti-heal is online."],
        evidence: [`healingThreats=${threats}`],
      });
    },
  },
  {
    id: "enemy_item_spike",
    category: "items",
    tags: ["items", "power-spike", "scoreboard"],
    description: "Warn when detected enemy items imply a burst or penetration spike.",
    evaluate: (ctx) => {
      const spike = firstItem(ctx.enemyItems, ["Blade of Despair", "Divine Glaive", "Holy Crystal", "Malefic Roar", "Genius Wand", "Glowing Wand"]);
      if (!spike) return null;
      return scenario(ctx, {
        ruleId: "enemy_item_spike",
        category: "items",
        scene: "counter",
        priority: "medium",
        callout: `Respect ${spike}.`,
        reason: "The enemy build has reached a fight-changing damage or penetration item.",
        recommendedAction: "Avoid isolated fights and consider defensive counter-items before the next engage.",
        tags: ["item-spike", "counter-build"],
        evidence: [`enemyItem=${spike}`],
      });
    },
  },
  {
    id: "retribution_contest",
    category: "objective",
    tags: ["retribution", "objective", "jungle"],
    description: "Warn when bursting Turtle/Lord while enemy Retribution is likely ready.",
    evaluate: (ctx) => {
      if (ctx.screen !== "live_hud" || ctx.role !== "jungle") return null;
      const objective = ctx.objectiveName ?? String(ctx.signals.objectiveName ?? "");
      if (!objective.toLowerCase().includes("turtle") && !objective.toLowerCase().includes("lord")) return null;
      const contestNow = ctx.objectiveActive || (ctx.signals.objectiveActive === true) || (ctx.objectiveSpawnsInSec ?? 999) <= 20;
      if (!contestNow) return null;
      const enemySmiteThreat = ctx.signals.enemyRetributionReady === true;
      const teamMissingSmite = ctx.signals.teamHasRetribution === false;
      if (!enemySmiteThreat && !teamMissingSmite) return null;
      return scenario(ctx, {
        ruleId: "retribution_contest",
        category: "objective",
        scene: "map",
        priority: "high",
        callout: "Check enemy Retribution.",
        reason: `${objective} is contestable but enemy smite may be up.`,
        recommendedAction: "Confirm enemy jungler position and Retribution before committing burst.",
        tags: ["retribution", "objective"],
      });
    },
  },
  {
    id: "objective_active_secure",
    category: "objective",
    tags: ["objective", "secure", "smite-window"],
    description: "When Turtle or Lord is visible/active, switch from setup to secure-or-zone calls.",
    evaluate: (ctx) => {
      if (!ctx.objectiveActive) return null;
      const objective = ctx.objectiveName ?? firstObjective(ctx.visibleObjectives) ?? "Objective";
      const hasEnemyMapInfo = ctx.enemyMarkerCount > 0 || ctx.lastSeenEnemies > 0 || ctx.missingEnemyCount !== undefined || ctx.deadEnemies > 0;
      const enemyPressureLimited = hasEnemyMapInfo && ctx.visibleEnemies <= 2 && (ctx.missingEnemyCount ?? 0) <= 2;
      if (ctx.deadEnemies > ctx.deadAllies || enemyPressureLimited) {
        return scenario(ctx, {
          ruleId: "objective_active_secure",
          category: "objective",
          scene: "map",
          priority: "high",
          callout: `${objective} is active: secure with numbers.`,
          reason: "The objective is visible and enemy pressure is limited or numbers are favorable.",
          recommendedAction: "Zone entrances first, then commit burst and secure.",
          tags: ["objective", "secure"],
        });
      }
      return scenario(ctx, {
        ruleId: "objective_active_contest",
        category: "objective",
        scene: "map",
        priority: "high",
        callout: `${objective} is active: contest carefully.`,
        reason: "The objective is visible but enemy pressure is still live.",
        recommendedAction: "Check enemy jungler position before committing burst.",
        tags: ["objective", "contest"],
      });
    },
  },
  {
    id: "objective_blind_risk",
    category: "objective",
    tags: ["objective", "vision", "missing-enemies"],
    description: "Do not start objectives when enemies are missing and river vision is absent.",
    evaluate: (ctx) => {
      if (!ctx.objectiveSoon || (ctx.missingEnemyCount ?? 0) < 3 || ctx.riverVision !== false) return null;
      const objective = ctx.objectiveName ?? "Objective";
      return scenario(ctx, {
        ruleId: "objective_blind_risk",
        category: "objective",
        scene: "map",
        priority: "high",
        callout: `${objective} soon: do not start blind.`,
        reason: "Three or more enemies are missing and river vision is absent.",
        recommendedAction: "Secure river vision before committing.",
        tags: ["objective", "vision", "missing"],
        evidence: [`missingEnemies=${ctx.missingEnemyCount}`, "riverVision=false"],
      });
    },
  },
  {
    id: "objective_trade_behind",
    category: "objective",
    tags: ["objective", "behind", "trade"],
    description: "When behind and objective vision is bad, recommend trading cross-map instead of flipping.",
    evaluate: (ctx) => {
      if (!ctx.objectiveSoon || ctx.goldState !== "behind" || ctx.riverVision !== false) return null;
      const objective = ctx.objectiveName ?? "Objective";
      return scenario(ctx, {
        ruleId: "objective_trade_behind",
        category: "objective",
        scene: "map",
        priority: "high",
        callout: `Do not flip ${objective}.`,
        reason: "The team is behind and lacks reliable setup vision.",
        recommendedAction: "Trade the opposite wave, turret, or enemy jungle instead of forcing a low-info contest.",
        tags: ["objective", "trade", "behind"],
      });
    },
  },
  {
    id: "objective_numbers_advantage",
    category: "objective",
    tags: ["objective", "numbers", "setup"],
    description: "Use enemy deaths and visible enemy count to accelerate objective starts.",
    evaluate: (ctx) => {
      if (!ctx.objectiveSoon || ctx.deadEnemies <= ctx.deadAllies || ctx.deadEnemies < 1) return null;
      const objective = ctx.objectiveName ?? "Objective";
      return scenario(ctx, {
        ruleId: "objective_numbers_advantage",
        category: "objective",
        scene: "map",
        priority: "high",
        callout: `${objective}: start with numbers.`,
        reason: "Enemy death timers create a temporary objective window.",
        recommendedAction: "Push mid first, then control entrances and secure.",
        tags: ["objective", "numbers-up"],
      });
    },
  },
  {
    id: "lord_late_priority",
    category: "objective",
    tags: ["lord", "late", "macro"],
    description: "Late game: treat Lord timers as primary win condition when no base emergency exists.",
    evaluate: (ctx) => {
      if (ctx.phase !== "late" || ctx.baseUnderAttack || ctx.enemyLordPush) return null;
      const lordSoon = ctx.objectiveSoon && String(ctx.objectiveName ?? "").toLowerCase().includes("lord");
      const lordActive = ctx.objectiveActive && (ctx.visibleObjectives.includes("lord") || String(ctx.objectiveName ?? "").toLowerCase().includes("lord"));
      if (!lordSoon && !lordActive) return null;
      return scenario(ctx, {
        ruleId: "lord_late_priority",
        category: "objective",
        scene: "map",
        priority: "high",
        callout: "Late Lord: group and setup.",
        reason: "Late phase Lord pressure decides structure and enhanced minions.",
        recommendedAction: "Group mid, secure vision, and commit only with numbers or power spike.",
        tags: ["lord", "late"],
      });
    },
  },
  {
    id: "turtle_early_setup",
    category: "objective",
    tags: ["turtle", "early", "setup"],
    description: "First Turtle window in early game needs mid prio and river vision.",
    evaluate: (ctx) => {
      if (ctx.phase !== "early" || !ctx.objectiveSoon) return null;
      const turtle = String(ctx.objectiveName ?? "").toLowerCase().includes("turtle") || ctx.visibleObjectives.includes("turtle");
      if (!turtle) return null;
      if (ctx.objectiveSpawnsInSec !== undefined && ctx.objectiveSpawnsInSec > 90) return null;
      return scenario(ctx, {
        ruleId: "turtle_early_setup",
        category: "objective",
        scene: "map",
        priority: "medium",
        callout: "First Turtle: prep now.",
        reason: "Early Turtle timing rewards mid wave control and jungle Retribution readiness.",
        recommendedAction: "Clear mid, ward river, and path jungle to spawn with lane prio.",
        tags: ["turtle", "early"],
      });
    },
  },
  {
    id: "objective_setup",
    category: "objective",
    tags: ["objective", "setup", "river"],
    description: "Default objective setup when a timer is close and no stronger blocker exists.",
    evaluate: (ctx) => {
      if (!ctx.objectiveSoon) return null;
      const needsCrash = ctx.waveState === "push" || ctx.waveState === "large" || ctx.waveState === "slow";
      const midNotReady = ctx.lanePressure.mid !== "winning" && ctx.lanePressure.mid !== "unknown";
      if (needsCrash || midNotReady) return null;
      const objective = ctx.objectiveName ?? "Objective";
      return scenario(ctx, {
        ruleId: "objective_setup",
        category: "objective",
        scene: "map",
        priority: "high",
        callout: `${objective} setup now.`,
        reason: "An objective timing window is approaching.",
        recommendedAction: "Clear waves and establish river control.",
        tags: ["objective", "setup"],
        evidence: ctx.objectiveSpawnsInSec !== undefined ? [`spawnsIn=${ctx.objectiveSpawnsInSec}s`] : [],
      });
    },
  },
  {
    id: "split_push_threat",
    category: "defense",
    tags: ["split-push", "side-lane", "turret"],
    description: "Answer side-lane pressure before grouping when a turret or inhibitor is threatened.",
    evaluate: (ctx) => {
      if (!ctx.splitPushThreat && !ctx.turretUnderThreat) return null;
      const lane = ctx.laneToPressure ? `${ctx.laneToPressure.toUpperCase()} lane` : "side lane";
      return scenario(ctx, {
        ruleId: "split_push_threat",
        category: "defense",
        scene: "map",
        priority: "high",
        callout: `Answer ${lane} pressure.`,
        reason: "A side wave or turret threat can cost structure before the next team play.",
        recommendedAction: "Send the safest wave-clear hero, then regroup after the wave is fixed.",
        tags: ["split-push", "defense"],
      });
    },
  },
  {
    id: "roam_gank_setup",
    category: "lane",
    tags: ["roam", "gank", "missing"],
    description: "Roam role or missing enemy roam with losing side lane — set up gank or cover.",
    evaluate: (ctx) => {
      if (ctx.screen !== "live_hud") return null;
      const losingSide = ctx.lanePressure.gold === "losing" || ctx.lanePressure.exp === "losing";
      if (!losingSide) return null;
      if (ctx.role === "roam" && ctx.goldState !== "behind") {
        return scenario(ctx, {
          ruleId: "roam_gank_setup",
          category: "lane",
          scene: "map",
          priority: "medium",
          callout: "Roam: set up lane gank.",
          reason: "A side lane is losing and you are on roam with acceptable gold state.",
          recommendedAction: "Crash the losing lane wave and engage with ally cooldowns.",
          tags: ["roam", "gank"],
        });
      }
      if (missingKeyEnemy(ctx, ["roam"]) && (ctx.missingEnemyCount ?? 0) >= 1) {
        return scenario(ctx, {
          ruleId: "roam_gank_setup",
          category: "lane",
          scene: "map",
          priority: "high",
          callout: "Enemy roam missing: punish lane.",
          reason: "Enemy roam is not confirmed while a side lane is losing.",
          recommendedAction: "Play aggressive on the losing lane or invade enemy jungle with vision.",
          tags: ["roam", "missing", "gank"],
        });
      }
      return null;
    },
  },
  {
    id: "gold_lane_collapse",
    category: "lane",
    tags: ["gold-lane", "gank-risk", "missing-roam"],
    description: "Protect Gold lane when it is losing and enemy roam/jungler information is missing.",
    evaluate: (ctx) => {
      if (ctx.lanePressure.gold !== "losing") return null;
      const missing = missingKeyEnemy(ctx, ["roam", "jungler", "jungle"]);
      if (!missing && (ctx.missingEnemyCount ?? 0) < 2) return null;
      return scenario(ctx, {
        ruleId: "gold_lane_collapse",
        category: "lane",
        scene: "map",
        priority: "high",
        callout: "Cover Gold lane now.",
        reason: "Gold lane is losing while enemy roam or jungler information is missing.",
        recommendedAction: "Hover Gold, catch the wave, and avoid forcing river alone.",
        tags: ["gold-lane", "counter-gank"],
      });
    },
  },
  {
    id: "exp_lane_dive_risk",
    category: "lane",
    tags: ["exp-lane", "dive", "side-lane"],
    description: "Warn about EXP-side dives when EXP is losing and enemy positions are unconfirmed.",
    evaluate: (ctx) => {
      if (ctx.lanePressure.exp !== "losing" || (ctx.missingEnemyCount ?? 0) < 2) return null;
      return scenario(ctx, {
        ruleId: "exp_lane_dive_risk",
        category: "lane",
        scene: "map",
        priority: "medium",
        callout: "EXP lane can be dove.",
        reason: "EXP lane is losing and multiple enemy positions are not confirmed.",
        recommendedAction: "Ping the wave, cover the next crash, or trade Gold-side pressure.",
        tags: ["exp-lane", "dive-risk"],
      });
    },
  },
  {
    id: "mid_no_priority",
    category: "lane",
    tags: ["mid", "rotation", "objective"],
    description: "Avoid river moves when mid has no priority and enemies are missing.",
    evaluate: (ctx) => {
      if (ctx.lanePressure.mid === "winning" || (ctx.missingEnemyCount ?? 0) < 2) return null;
      return scenario(ctx, {
        ruleId: "mid_no_priority",
        category: "lane",
        scene: "map",
        priority: "medium",
        callout: "Mid priority is not secured.",
        reason: "Mid lane cannot safely move first while enemy positions are unclear.",
        recommendedAction: "Clear mid wave before entering river or invading.",
        tags: ["mid", "rotation"],
      });
    },
  },
  {
    id: "all_enemies_missing",
    category: "map",
    tags: ["missing-enemies", "bush", "collapse"],
    description: "Maximum danger state when four or more enemies are unconfirmed.",
    evaluate: (ctx) => {
      if ((ctx.missingEnemyCount ?? 0) < 4) return null;
      return scenario(ctx, {
        ruleId: "all_enemies_missing",
        category: "map",
        scene: "counter",
        priority: "high",
        callout: `${ctx.missingEnemyCount} enemies missing: assume collapse.`,
        reason: "Most enemy positions are unconfirmed.",
        recommendedAction: "Do not face-check; play behind minion waves or confirmed allies.",
        tags: ["missing", "collapse"],
      });
    },
  },
  {
    id: "missing_enemies",
    category: "map",
    tags: ["missing-enemies", "vision"],
    description: "General missing-enemy warning when three positions are unconfirmed.",
    evaluate: (ctx) => {
      if ((ctx.missingEnemyCount ?? 0) < 3) return null;
      return scenario(ctx, {
        ruleId: "missing_enemies",
        category: "map",
        scene: "counter",
        priority: "high",
        callout: `${ctx.missingEnemyCount} enemies missing.`,
        reason: "Multiple enemy positions are unconfirmed.",
        recommendedAction: "Avoid face-checking and hold safe vision.",
        tags: ["missing", "vision"],
      });
    },
  },
  {
    id: "low_health_reset",
    category: "tempo",
    tags: ["reset", "health", "tempo"],
    description: "Recommend reset when the player is low or explicitly flagged as needing reset.",
    evaluate: (ctx) => {
      if (!ctx.lowHealth && !ctx.needReset) return null;
      return scenario(ctx, {
        ruleId: "low_health_reset",
        category: "tempo",
        scene: "main",
        priority: "medium",
        callout: "Reset before the next fight.",
        reason: ctx.lowHealth ? "Low health makes the next rotation unsafe." : "Reset timing was flagged by the state model.",
        recommendedAction: "Recall after clearing the nearest safe wave or camp.",
        tags: ["reset", "tempo"],
      });
    },
  },
  {
    id: "spend_gold_power_spike",
    category: "tempo",
    tags: ["gold", "shop", "power-spike"],
    description: "Convert unspent gold or a ready item spike into a reset call.",
    evaluate: (ctx) => {
      if (ctx.unspentGold < 900 && !ctx.powerSpikeReady) return null;
      return scenario(ctx, {
        ruleId: "spend_gold_power_spike",
        category: "tempo",
        scene: "main",
        priority: "medium",
        callout: "Spend gold before forcing.",
        reason: ctx.powerSpikeReady ? "A power spike is ready if you reset and shop." : `${ctx.unspentGold} unspent gold is enough to change the next fight.`,
        recommendedAction: "Crash a wave or finish a camp, recall, then fight on the completed item.",
        tags: ["reset", "gold"],
      });
    },
  },
  {
    id: "ahead_invade_window",
    category: "tempo",
    tags: ["ahead", "invade", "jungle"],
    description: "When ahead and information is sufficient, recommend controlled enemy jungle pressure.",
    evaluate: (ctx) => {
      if (ctx.goldState !== "ahead" || ctx.riverVision === false || (ctx.missingEnemyCount ?? 0) >= 3) return null;
      if (!ctx.invadeWindow && ctx.role !== "jungle" && ctx.role !== "roam") return null;
      return scenario(ctx, {
        ruleId: "ahead_invade_window",
        category: "tempo",
        scene: "map",
        priority: "medium",
        callout: "Use the lead to take enemy space.",
        reason: "The team is ahead and no higher-risk objective or missing-enemy rule is blocking the play.",
        recommendedAction: "Invade with lane priority, place vision, and leave after taking one resource.",
        tags: ["ahead", "invade"],
      });
    },
  },
  {
    id: "defensive_warding_behind",
    category: "map",
    tags: ["behind", "vision", "defense"],
    description: "Behind in mid/late without river vision — ward defensively before contests.",
    evaluate: (ctx) => {
      if (ctx.goldState !== "behind" || ctx.riverVision !== false) return null;
      if (ctx.phase === "early" || ctx.phase === "unknown") return null;
      if (ctx.objectiveActive) return null;
      return scenario(ctx, {
        ruleId: "defensive_warding_behind",
        category: "map",
        scene: "counter",
        priority: "medium",
        callout: "Behind: ward defensively.",
        reason: "Team is behind and lacks river vision in mid or late phase.",
        recommendedAction: "Place defensive wards on jungle entrances; avoid blind river fights.",
        tags: ["behind", "vision"],
      });
    },
  },
  {
    id: "behind_safe_farm",
    category: "tempo",
    tags: ["behind", "farm", "defense"],
    description: "Default behind-state macro: defend waves and avoid low-information fights.",
    evaluate: (ctx) => {
      if (ctx.goldState !== "behind") return null;
      if (ctx.riverVision === false && ctx.phase !== "early" && ctx.phase !== "unknown") return null;
      return scenario(ctx, {
        ruleId: "behind_safe_farm",
        category: "tempo",
        scene: "main",
        priority: "medium",
        callout: "Stabilize: farm safe waves.",
        reason: "The team is behind and no immediate objective trade or defense rule is stronger.",
        recommendedAction: "Clear waves near towers, protect jungle entrances, and wait for enemy overreach.",
        tags: ["behind", "farm"],
      });
    },
  },
  {
    id: "minimap_activity",
    category: "map",
    tags: ["minimap", "rotation", "tracking"],
    description: "Use trusted enemy markers as a rotation alert when no stronger scenario exists.",
    evaluate: (ctx) => {
      if (ctx.screen !== "live_hud" || ctx.enemyMarkerCount <= 0) return null;
      const heroes = ctx.signals.mapMonitor?.markers
        ?.filter((marker) => marker.side === "enemy" && marker.status === "visible" && marker.heroName)
        .map((marker) => marker.heroName)
        .slice(0, 2) ?? [];
      return scenario(ctx, {
        ruleId: "minimap_activity",
        category: "map",
        scene: "map",
        priority: "medium",
        callout: heroes.length ? `Enemy map activity: ${heroes.join(" and ")}.` : "Enemy map activity detected.",
        reason: "Minimap markers were recognized in live play.",
        recommendedAction: "Track rotations before forcing a fight.",
        tags: ["minimap", "rotation"],
      });
    },
  },
  {
    id: "build_review",
    category: "items",
    tags: ["scoreboard", "item-shop", "build"],
    description: "Scoreboard and shop are information surfaces unless a specific item-counter rule fires.",
    evaluate: (ctx) => {
      if (ctx.screen !== "scoreboard" && ctx.screen !== "item_shop") return null;
      return scenario(ctx, {
        ruleId: "build_review",
        category: "items",
        scene: "main",
        priority: "low",
        callout: ctx.screen === "item_shop" ? "Buy quickly, then return to map." : "Review detected builds.",
        reason: "Build information is visible but no urgent counter-rule fired.",
        recommendedAction: ctx.screen === "item_shop" ? "Complete the next item component and leave shop." : "Wait for validated item counters.",
        tags: ["items", ctx.screen],
      });
    },
  },
  {
    id: "ultimate_ready_engage",
    category: "fight",
    tags: ["ultimate", "engage", "power-spike"],
    description: "Ultimate online with favorable fight or pick window.",
    evaluate: (ctx) => {
      if (!ctx.ultimateReady || ctx.screen !== "live_hud") return null;
      if (ctx.deadAllies > ctx.deadEnemies || ctx.lowHealth) return null;
      if (ctx.deadEnemies < 1 && (ctx.missingEnemyCount ?? 0) >= 3) return null;
      return scenario(ctx, {
        ruleId: "ultimate_ready_engage",
        category: "fight",
        scene: "main",
        priority: "medium",
        callout: "Ult ready: play for pick.",
        reason: "Ultimate is available while the map is not in a numbers-down state.",
        recommendedAction: "Force a skirmish on a wave crash or invade with one camp of vision.",
        tags: ["ultimate", "engage"],
        evidence: ctx.deadEnemies > 0 ? [`deadEnemies=${ctx.deadEnemies}`] : [],
      });
    },
  },
  {
    id: "mid_rotation_winning",
    category: "lane",
    tags: ["mid", "rotation", "winning"],
    description: "Winning mid with missing enemies enables roam or river control.",
    evaluate: (ctx) => {
      if (ctx.lanePressure.mid !== "winning" || (ctx.missingEnemyCount ?? 0) < 2) return null;
      if (ctx.objectiveSoon || ctx.baseUnderAttack) return null;
      return scenario(ctx, {
        ruleId: "mid_rotation_winning",
        category: "lane",
        scene: "map",
        priority: "medium",
        callout: "Mid won: rotate with prio.",
        reason: "Mid lane has priority while multiple enemies are unconfirmed.",
        recommendedAction: "Roam to side lane with wave crash or secure river vision.",
        tags: ["mid", "rotation"],
      });
    },
  },
  {
    id: "buff_contest_window",
    category: "tempo",
    tags: ["buff", "ahead", "jungle"],
    description: "Ahead with buff threat signal — contest or steal with vision.",
    evaluate: (ctx) => {
      if (!ctx.buffThreat || ctx.goldState !== "ahead" || ctx.riverVision === false) return null;
      return scenario(ctx, {
        ruleId: "buff_contest_window",
        category: "tempo",
        scene: "map",
        priority: "medium",
        callout: `Contest ${ctx.buffThreat} with lead.`,
        reason: "Team is ahead and a buff window was detected.",
        recommendedAction: "Enter with lane prio, take one buff, and leave before collapse.",
        tags: ["buff", "ahead"],
        evidence: [`buff=${ctx.buffThreat}`],
      });
    },
  },
  {
    id: "wave_crash_objective",
    category: "objective",
    tags: ["wave", "crash", "setup"],
    description: "Objective soon but wave must be crashed first.",
    evaluate: (ctx) => {
      if (!ctx.objectiveSoon || ctx.screen !== "live_hud") return null;
      const needsCrash = ctx.waveState === "push" || ctx.waveState === "large" || ctx.waveState === "slow";
      const midNotReady = ctx.lanePressure.mid !== "winning" && ctx.lanePressure.mid !== "unknown";
      if (!needsCrash && !midNotReady) return null;
      return scenario(ctx, {
        ruleId: "wave_crash_objective",
        category: "objective",
        scene: "map",
        priority: "medium",
        callout: "Crash wave before objective.",
        reason: "Objective timer is close but lane wave state is not ready for river.",
        recommendedAction: "Fast-clear mid or side wave, then move to pit with vision.",
        tags: ["wave", "objective"],
        evidence: ctx.waveState ? [`wave=${ctx.waveState}`] : ["midPriority=low"],
      });
    },
  },
  {
    id: "early_clear_plan",
    category: "tempo",
    tags: ["early", "clear", "pathing"],
    description: "Low-risk early-game default when no gank, objective, or danger rule is active.",
    evaluate: (ctx) => {
      if (ctx.phase !== "early" || ctx.screen !== "live_hud") return null;
      return scenario(ctx, {
        ruleId: "early_clear_plan",
        category: "tempo",
        scene: "main",
        priority: "low",
        callout: "Keep the first clear clean.",
        reason: "No urgent live rule fired during the early phase.",
        recommendedAction: ctx.role === "jungle" ? "Finish the planned camp path and check lane priority." : "Secure lane wave before rotating.",
        tags: ["early", "pathing"],
      });
    },
  },
  {
    id: "stable_state",
    category: "map",
    tags: ["stable", "fallback"],
    description: "Safe fallback when no deterministic tactical scenario is active.",
    evaluate: (ctx) => stableScenario(ctx),
  },
];

function stableScenario(ctx: ReasoningContext): ScenarioMatch {
  return scenario(ctx, {
    ruleId: "stable_state",
    category: "map",
    scene: "main",
    priority: "low",
    callout: "Map state stable.",
    reason: "No urgent deterministic rule fired.",
    recommendedAction: "Continue tracking enemies and objectives.",
    tags: ["stable"],
  });
}

function scenario(ctx: ReasoningContext, match: Omit<ScenarioMatch, "scenarioId"> & { scenarioId?: string }): ScenarioMatch {
  return {
    ...match,
    scenarioId: match.scenarioId ?? match.ruleId,
    confidence: match.confidence ?? ctx.confidence,
    nextActions: match.nextActions ?? [match.recommendedAction],
    warnings: match.warnings ?? [],
    evidence: match.evidence ?? defaultEvidence(ctx),
  };
}

function decision(
  base: Omit<LiveReasoningOutput, "scene" | "priority" | "callout" | "reason" | "recommendedAction" | "ruleId" | "itemAdjustment" | "scenario" | "nextActions" | "warnings" | "evidence" | "alternatives">,
  match: ScenarioMatch,
  alternatives: ScenarioMatch[],
): LiveReasoningOutput {
  const output: LiveReasoningOutput = {
    ...base,
    scene: match.scene,
    priority: match.priority,
    callout: match.callout,
    reason: match.reason,
    recommendedAction: match.recommendedAction,
    confidence: clamp01(match.confidence ?? base.confidence),
    ruleId: match.ruleId,
    scenario: {
      id: match.scenarioId,
      category: match.category,
      tags: match.tags,
    },
    nextActions: (match.nextActions?.length ? match.nextActions : [match.recommendedAction]).slice(0, 4),
    warnings: (match.warnings ?? []).slice(0, 4),
    evidence: (match.evidence ?? []).slice(0, 6),
    alternatives: alternatives
      .filter((candidate) => candidate.ruleId !== match.ruleId)
      .slice(0, 3)
      .map((candidate) => ({
        ruleId: candidate.ruleId,
        scenarioId: candidate.scenarioId,
        category: candidate.category,
        priority: candidate.priority,
        callout: candidate.callout,
        recommendedAction: candidate.recommendedAction,
      })),
  };
  if (match.itemAdjustment) output.itemAdjustment = match.itemAdjustment;
  return output;
}

function buildBase(input: LiveReasoningInput, ctx: ReasoningContext) {
  const observation = {
    screen: ctx.screen,
    phase: ctx.phase,
    role: ctx.role,
    goldState: ctx.goldState,
    missingEnemyCount: ctx.missingEnemyCount,
    missingEnemies: ctx.missingEnemies,
    objectiveName: ctx.objectiveName,
    objectiveSpawnsInSec: ctx.objectiveSpawnsInSec,
    objectiveSoon: ctx.objectiveSoon,
    objectiveActive: ctx.objectiveActive,
    riverVision: ctx.riverVision,
    enemyMarkerCount: ctx.enemyMarkerCount,
    visibleEnemies: ctx.visibleEnemies,
    lastSeenEnemies: ctx.lastSeenEnemies,
    visibleAllies: ctx.visibleAllies,
    deadAllies: ctx.deadAllies,
    deadEnemies: ctx.deadEnemies,
    healingThreats: ctx.healingThreats,
    enemyItems: ctx.enemyItems,
    allyItems: ctx.allyItems,
    lanePressure: ctx.lanePressure,
  };
  return {
    sourceFrameId: String(input.frameId ?? `reasoning-${Date.now()}`),
    source: String(input.source ?? "live-observation"),
    timestamp: finiteOptional(input.timestamp) ?? Date.now(),
    confidence: ctx.confidence,
    observation,
    modelVersion: LIVE_REASONING_MODEL_VERSION,
    updatedAt: new Date().toISOString(),
  };
}

function buildContext(input: LiveReasoningInput): ReasoningContext {
  const signals = input.signals ?? {};
  const screen = String(input.screen ?? "unknown");
  const confidence = clamp01(input.confidence);
  const minimapMarkers = input.minimapMarkers ?? [];
  const trustedMarkers = minimapMarkers.filter((marker) => clamp01(marker.confidence) >= DETECTED_FACT_CONFIDENCE);
  const enemyMarkerCount = trustedMarkers.filter((marker) => marker.side === "enemy").length;
  const allyMarkerCount = trustedMarkers.filter((marker) => marker.side === "ally").length;
  const mapMonitor = signals.mapMonitor;
  const visibleEnemies = finiteOptional(mapMonitor?.visibleEnemies) ?? enemyMarkerCount;
  const visibleAllies = finiteOptional(mapMonitor?.visibleAllies) ?? allyMarkerCount;
  const lastSeenEnemies = finiteOptional(mapMonitor?.lastSeenEnemies) ?? 0;
  const missingEnemies = toStringArray(signals.missingEnemies);
  const inferredMissing = mapMonitor && (visibleEnemies > 0 || lastSeenEnemies > 0)
    ? Math.max(0, 5 - visibleEnemies)
    : undefined;
  const missingEnemyCount = finiteOptional(signals.missingEnemyCount) ?? (missingEnemies.length || inferredMissing);
  const timerFacts = Array.isArray(signals.timerFacts) ? signals.timerFacts : [];
  const objectiveTimer = nearestObjectiveTimer(timerFacts);
  const objectiveSpawnsInSec = finiteOptional(signals.objectiveSpawnsInSec) ?? objectiveTimer?.seconds;
  const objectiveSoon = Boolean(signals.objectiveSoon) || (objectiveSpawnsInSec !== undefined && objectiveSpawnsInSec <= 60);
  const visibleObjectives = toStringArray(mapMonitor?.visibleObjectives);
  const objectiveName = signals.objectiveName
    ? String(signals.objectiveName)
    : objectiveTimer?.name ?? firstObjective(visibleObjectives) ?? (objectiveSoon ? "Objective" : undefined);
  const objectiveActive = Boolean(signals.objectiveActive) || visibleObjectives.some((objective) => objective === "turtle" || objective === "lord");
  const enemyRespawns = numberArray(signals.enemyRespawns);
  const allyRespawns = numberArray(signals.allyRespawns);
  appendOptional(enemyRespawns, finiteOptional(signals.enemyRespawnInSec));
  appendOptional(allyRespawns, finiteOptional(signals.allyRespawnInSec));
  for (const fact of timerFacts) {
    const seconds = finiteOptional(fact.seconds) ?? finiteOptional(fact.value);
    if (seconds === undefined) continue;
    if (fact.timerType === "enemy_respawn_timer") enemyRespawns.push(seconds);
    if (fact.timerType === "ally_respawn_timer") allyRespawns.push(seconds);
  }
  const deadEnemies = finiteOptional(signals.deadEnemies) ?? finiteOptional(signals.enemyDeadCount) ?? enemyRespawns.length;
  const deadAllies = finiteOptional(signals.deadAllies) ?? finiteOptional(signals.allyDeadCount) ?? allyRespawns.length;
  const lanePressure = normalizeLanePressure(signals.lanePressure);
  const matchTimeSeconds = finiteOptional(signals.matchTimeSeconds);
  return {
    input,
    signals,
    screen,
    confidence,
    enemyMarkerCount,
    allyMarkerCount,
    visibleEnemies,
    visibleAllies,
    lastSeenEnemies,
    missingEnemies,
    missingEnemyCount,
    objectiveName,
    objectiveSpawnsInSec,
    objectiveSoon,
    objectiveActive,
    visibleObjectives,
    riverVision: typeof signals.riverVision === "boolean" ? signals.riverVision : undefined,
    healingThreats: toStringArray(signals.enemyHealingThreats),
    teamHasAntiHeal: typeof signals.teamHasAntiHeal === "boolean" ? signals.teamHasAntiHeal : undefined,
    enemyItems: toStringArray(signals.enemyItems),
    allyItems: toStringArray(signals.allyItems),
    timerFacts,
    phase: normalizePhase(signals.phase, matchTimeSeconds),
    role: normalizeRole(signals.role),
    goldState: normalizeGoldState(signals.goldState, signals.goldLead),
    lanePressure,
    laneToPressure: normalizeLane(signals.laneToPressure),
    lowHealth: Boolean(signals.lowHealth),
    needReset: Boolean(signals.needReset),
    unspentGold: finiteOptional(signals.unspentGold) ?? 0,
    powerSpikeReady: Boolean(signals.powerSpikeReady),
    ultimateReady: Boolean(signals.ultimateReady),
    alliesNearby: finiteOptional(signals.alliesNearby) ?? visibleAllies,
    enemiesNearby: finiteOptional(signals.enemiesNearby) ?? visibleEnemies,
    deadAllies,
    deadEnemies,
    allyRespawns,
    enemyRespawns,
    baseUnderAttack: Boolean(signals.baseUnderAttack),
    turretUnderThreat: Boolean(signals.turretUnderThreat),
    splitPushThreat: Boolean(signals.splitPushThreat),
    enemyLordPush: Boolean(signals.enemyLordPush),
    lordEnhancedMinions: Boolean(signals.lordEnhancedMinions),
    invadeWindow: Boolean(signals.invadeWindow),
    buffThreat: signals.buffThreat ? String(signals.buffThreat) : undefined,
    waveState: signals.waveState ? String(signals.waveState) : undefined,
  };
}

function defaultEvidence(ctx: ReasoningContext) {
  const evidence = [
    `screen=${ctx.screen}`,
    `confidence=${ctx.confidence.toFixed(2)}`,
  ];
  if (ctx.phase !== "unknown") evidence.push(`phase=${ctx.phase}`);
  if (ctx.objectiveName) evidence.push(`objective=${ctx.objectiveName}`);
  if (ctx.missingEnemyCount !== undefined) evidence.push(`missing=${ctx.missingEnemyCount}`);
  if (ctx.goldState !== "unknown") evidence.push(`gold=${ctx.goldState}`);
  return evidence;
}

function normalizeLanePressure(value: unknown): Record<LaneId, LanePressure> {
  const source = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return {
    exp: normalizePressure(source.exp),
    mid: normalizePressure(source.mid),
    gold: normalizePressure(source.gold),
  };
}

function normalizePressure(value: unknown): LanePressure {
  const text = String(value ?? "unknown").toLowerCase();
  return text === "winning" || text === "even" || text === "losing" ? text : "unknown";
}

function normalizeGoldState(value: unknown, goldLead: unknown): GoldState {
  const text = String(value ?? "").toLowerCase();
  if (text === "ahead" || text === "even" || text === "behind") return text;
  const lead = finiteOptional(goldLead);
  if (lead === undefined) return "unknown";
  if (lead >= 1500) return "ahead";
  if (lead <= -1500) return "behind";
  return "even";
}

function normalizePhase(value: unknown, matchTimeSeconds?: number): MatchPhase {
  const text = String(value ?? "").toLowerCase();
  if (text === "early" || text === "mid" || text === "late") return text;
  if (matchTimeSeconds === undefined) return "unknown";
  if (matchTimeSeconds < 300) return "early";
  if (matchTimeSeconds < 720) return "mid";
  return "late";
}

function normalizeRole(value: unknown) {
  const text = String(value ?? "unknown").toLowerCase();
  return ["jungle", "exp", "gold", "mid", "roam"].includes(text) ? text : "unknown";
}

function normalizeLane(value: unknown): LaneId | undefined {
  const text = String(value ?? "").toLowerCase().replace(/\s+lane$/, "");
  return text === "exp" || text === "mid" || text === "gold" ? text : undefined;
}

function nearestObjectiveTimer(timerFacts: TimerFactLike[]) {
  const timers = timerFacts
    .map((fact) => {
      const seconds = finiteOptional(fact.seconds) ?? finiteOptional(fact.value);
      const type = String(fact.timerType ?? "");
      const name = type.includes("lord") ? "Lord" : type.includes("turtle") ? "Turtle" : "";
      return seconds !== undefined && name ? { name, seconds } : null;
    })
    .filter((timer): timer is { name: string; seconds: number } => Boolean(timer))
    .sort((left, right) => left.seconds - right.seconds);
  return timers[0];
}

function firstObjective(objectives: string[]) {
  const objective = objectives.find((item) => item === "lord" || item === "turtle");
  if (!objective) return undefined;
  return objective === "lord" ? "Lord" : "Turtle";
}

function firstItem(items: string[], names: string[]) {
  const normalized = items.map((item) => ({ item, key: item.toLowerCase() }));
  return names.find((name) => normalized.some((entry) => entry.key === name.toLowerCase()));
}

function missingKeyEnemy(ctx: ReasoningContext, names: string[]) {
  const missing = ctx.missingEnemies.map((enemy) => enemy.toLowerCase());
  return names.some((name) => missing.some((enemy) => enemy.includes(name)));
}

function toStringArray(value: unknown) {
  return Array.isArray(value) ? value.map(String).map((item) => item.trim()).filter(Boolean).slice(0, 10) : [];
}

function numberArray(value: unknown) {
  return Array.isArray(value) ? value.map(Number).filter(Number.isFinite).slice(0, 10) : [];
}

function appendOptional(list: number[], value?: number) {
  if (value !== undefined) list.push(value);
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
