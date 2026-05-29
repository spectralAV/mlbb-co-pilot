export type JunglerBoots = "Tough Boots" | "Warrior Boots" | "Arcane Boots" | "Swift Boots" | "Magic Shoes";
export type JunglerBlessing = "Ice" | "Flame" | "Bloody";

export type JunglerRecommendation = {
  heroId: number | null;
  hero: string;
  score: number;
  confidence: "high" | "medium" | "low";
  style: "utility" | "damage" | "hybrid";
  breakdown: {
    meta: number;
    teamBalance: number;
    enemyFit: number;
    relations: number;
    comfort: number;
  };
  reasons: string[];
  risks: string[];
  warningLevel: "none" | "medium" | "high";
  boots: {
    boots: JunglerBoots;
    reason: string;
    blessing: JunglerBlessing;
    blessingReason: string;
  };
};

type RuntimeHero = {
  id?: number;
  name?: string;
  roles?: Array<string | { title?: string }>;
  lanes?: Array<string | { title?: string }>;
  relations?: {
    assist?: number[];
    strong?: number[];
    weak?: number[];
  };
  meta?: {
    winRate?: number;
    banRate?: number;
    appearanceRate?: number;
    topSynergies?: Array<{ heroId?: number; deltaWinRate?: number }>;
  };
};

type RecommendationContext = {
  allies: any[];
  enemies: any[];
  unavailable: Set<string>;
  heroPool: string[];
  selectedLane?: string;
  laneDetected?: boolean;
  runtimeByName?: Map<string, RuntimeHero>;
};

const PHYSICAL_ROLES = new Set(["fighter", "marksman", "assassin"]);
const MAGIC_ROLES = new Set(["mage"]);

function normalize(value: unknown) {
  return String(value ?? "").trim().toLowerCase();
}

function compactName(hero: any) {
  return String(hero?.name ?? hero?.hero_name ?? hero?.raw?.hero_name ?? "Unknown Hero").trim();
}

function heroId(hero: any) {
  const id = Number(hero?.id ?? hero?.hero_id ?? hero?.raw?.id ?? hero?.raw?.hero_id);
  return Number.isFinite(id) ? id : null;
}

function laneKey(value: unknown) {
  return normalize(typeof value === "object" && value ? (value as any).title : value).replace(/\s+lane$/, "");
}

function toList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => String(typeof item === "object" && item ? (item as any).title ?? item : item)).map((item) => item.trim()).filter(Boolean);
  }
  return String(value ?? "").split(/[,/]/).map((item) => item.trim()).filter(Boolean);
}

function rolesOf(hero: any, runtimeHero?: RuntimeHero) {
  return toList(hero?.roles ?? hero?.role ?? hero?.raw?.role ?? runtimeHero?.roles).map(normalize);
}

function lanesOf(hero: any, runtimeHero?: RuntimeHero) {
  return toList(hero?.lanes ?? hero?.lane ?? hero?.raw?.lane ?? runtimeHero?.lanes).map(laneKey);
}

function specialtiesOf(hero: any) {
  return toList(hero?.specialties ?? hero?.speciality ?? hero?.raw?.speciality).map(normalize);
}

function tagsOf(hero: any) {
  return new Set([
    ...toList(hero?.semantic_tags).map(normalize),
    ...specialtiesOf(hero),
    ...rolesOf(hero)
  ]);
}

function hasAny(tags: Set<string>, values: string[]) {
  return values.some((value) => tags.has(value));
}

function isMagicDamage(hero: any, runtimeHero?: RuntimeHero) {
  const roles = rolesOf(hero, runtimeHero);
  const tags = tagsOf(hero);
  return roles.some((role) => MAGIC_ROLES.has(role)) || tags.has("magic-damage") || tags.has("magic damage") || tags.has("magic-burst");
}

function isPhysicalDamage(hero: any, runtimeHero?: RuntimeHero) {
  const roles = rolesOf(hero, runtimeHero);
  if (isMagicDamage(hero, runtimeHero)) return false;
  return roles.some((role) => PHYSICAL_ROLES.has(role)) || hasAny(tagsOf(hero), ["physical-damage", "damage"]);
}

function hasFrontline(hero: any) {
  const tags = tagsOf(hero);
  return hasAny(tags, ["frontline", "tank", "engage-durability", "guard"]) || rolesOf(hero).includes("tank");
}

function hasCrowdControl(hero: any) {
  return hasAny(tagsOf(hero), ["cc", "hard-cc", "crowd control", "control", "setup", "stun"]);
}

function hasMobility(hero: any) {
  return hasAny(tagsOf(hero), ["mobility", "dive", "chase", "blink", "backline-access"]);
}

function hasSustain(hero: any) {
  return hasAny(tagsOf(hero), ["sustain", "regen", "heal", "engage-durability"]);
}

function hasBurst(hero: any) {
  return hasAny(tagsOf(hero), ["burst", "magic-burst", "pickoff", "finisher", "assassin"]);
}

function classifyStyle(hero: any): JunglerRecommendation["style"] {
  const utility = (hasFrontline(hero) ? 2 : 0) + (hasCrowdControl(hero) ? 1 : 0) + (hasSustain(hero) ? 1 : 0);
  const damage = (hasBurst(hero) ? 2 : 0) + (hasMobility(hero) ? 1 : 0) + (isPhysicalDamage(hero) || isMagicDamage(hero) ? 1 : 0);
  if (utility > damage + 1) return "utility";
  if (damage > utility + 1) return "damage";
  return "hybrid";
}

function normalizeRate(value: unknown) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return 0;
  return number <= 1 ? number * 100 : number;
}

function metaComponent(runtimeHero?: RuntimeHero) {
  const winRate = normalizeRate(runtimeHero?.meta?.winRate);
  const banRate = normalizeRate(runtimeHero?.meta?.banRate);
  const appearanceRate = normalizeRate(runtimeHero?.meta?.appearanceRate);
  if (!winRate && !banRate && !appearanceRate) return 0;
  let score = 0;
  score += Math.max(-8, Math.min(12, (winRate - 50) * 1.7));
  score += Math.min(5, appearanceRate * 0.45);
  if (banRate > 30) score += 5;
  else if (banRate > 12) score += 3;
  return score;
}

function teamBalanceComponent(hero: any, allies: any[]) {
  const style = classifyStyle(hero);
  const allyTags = allies.map(tagsOf);
  const frontlineCount = allies.filter(hasFrontline).length;
  const ccCount = allies.filter(hasCrowdControl).length;
  const burstCount = allies.filter(hasBurst).length;
  const physicalCount = allies.filter((ally) => isPhysicalDamage(ally)).length;
  const magicCount = allies.filter((ally) => isMagicDamage(ally)).length;
  let score = 0;
  const reasons: string[] = [];
  const risks: string[] = [];

  if (frontlineCount === 0 && style === "utility") {
    score += 11;
    reasons.push("Adds needed frontline for objective fights");
  } else if (frontlineCount >= 2 && style === "utility") {
    score -= 5;
    risks.push("Team may already have enough frontline");
  }

  if (ccCount === 0 && hasCrowdControl(hero)) {
    score += 9;
    reasons.push("Adds reliable crowd control to the draft");
  }

  if (burstCount === 0 && hasBurst(hero)) {
    score += 8;
    reasons.push("Gives the team pickoff pressure");
  }

  if (isPhysicalDamage(hero) && physicalCount < magicCount) {
    score += 5;
    reasons.push("Balances team damage with physical threat");
  } else if (isMagicDamage(hero) && magicCount < physicalCount) {
    score += 5;
    reasons.push("Balances team damage with magic threat");
  } else if (isPhysicalDamage(hero) && physicalCount >= 3) {
    score -= 6;
    risks.push("Draft is leaning heavily physical");
  } else if (isMagicDamage(hero) && magicCount >= 3) {
    score -= 6;
    risks.push("Draft is leaning heavily magic");
  }

  if (allyTags.some((tags) => tags.has("engage")) && hasBurst(hero)) {
    score += 5;
    reasons.push("Can follow allied engage windows");
  }

  return { score, reasons, risks };
}

function enemyFitComponent(hero: any, enemies: any[]) {
  let score = 0;
  const reasons: string[] = [];
  const risks: string[] = [];
  const mobileEnemies = enemies.filter(hasMobility).length;
  const ccEnemies = enemies.filter(hasCrowdControl).length;
  const sustainEnemies = enemies.filter(hasSustain).length;
  const squishyEnemies = enemies.filter((enemy) => !hasFrontline(enemy) && (isMagicDamage(enemy) || isPhysicalDamage(enemy) || hasBurst(enemy))).length;

  if (mobileEnemies >= 2 && hasCrowdControl(hero)) {
    score += 8;
    reasons.push("Crowd control helps contain mobile enemies");
  }

  if (sustainEnemies > 0 && hasBurst(hero)) {
    score += 4;
    reasons.push("Burst damage can punish sustain heroes before fights reset");
  }

  if (squishyEnemies >= 2 && hasBurst(hero) && hasMobility(hero)) {
    score += 8;
    reasons.push("Enemy backline is vulnerable to mobile burst");
  }

  if (ccEnemies >= 3 && hasMobility(hero) && !hasSustain(hero) && !hasFrontline(hero)) {
    score -= 10;
    risks.push("Enemy control can punish risky jungle dives");
  }

  if (mobileEnemies >= 2 && !hasMobility(hero) && !hasCrowdControl(hero)) {
    score -= 6;
    risks.push("May struggle to catch the enemy mobility core");
  }

  return { score, reasons, risks, ccEnemies };
}

function relationComponent(hero: any, runtimeHero: RuntimeHero | undefined, allies: any[], enemies: any[], runtimeByName?: Map<string, RuntimeHero>) {
  const heroRelations = runtimeHero?.relations;
  if (!heroRelations && !runtimeHero?.meta?.topSynergies?.length) return { score: 0, reasons: [] as string[], risks: [] as string[] };
  const allyIds = new Set(allies.map(heroId).filter((id): id is number => id != null));
  const enemyIds = new Set(enemies.map(heroId).filter((id): id is number => id != null));
  const strong = new Set((heroRelations?.strong ?? []).map(Number));
  const weak = new Set((heroRelations?.weak ?? []).map(Number));
  const assist = new Set((heroRelations?.assist ?? []).map(Number));
  const topSynergies = runtimeHero?.meta?.topSynergies ?? [];
  let score = 0;
  const reasons: string[] = [];
  const risks: string[] = [];

  const strongHits = [...enemyIds].filter((id) => strong.has(id));
  if (strongHits.length > 0) {
    score += Math.min(12, strongHits.length * 7);
    reasons.push("Runtime matchup data favors this pick into visible enemies");
  }

  const weakHits = [...enemyIds].filter((id) => weak.has(id));
  if (weakHits.length > 0) {
    score -= Math.min(14, weakHits.length * 8);
    const names = weakHits.map((id) => findRuntimeName(id, runtimeByName)).filter(Boolean).slice(0, 2).join(", ");
    risks.push(names ? `Runtime matchup data warns into ${names}` : "Runtime matchup data flags enemy counters");
  }

  const assistHits = [...allyIds].filter((id) => assist.has(id));
  if (assistHits.length > 0) {
    score += Math.min(8, assistHits.length * 5);
    reasons.push("Has direct synergy with allied picks");
  }

  const synergyHits = topSynergies.filter((item) => item.heroId != null && allyIds.has(Number(item.heroId)));
  if (synergyHits.length > 0) {
    score += Math.min(7, synergyHits.reduce((sum, item) => sum + Math.max(1, normalizeRate(item.deltaWinRate) * 0.8), 0));
    reasons.push("Recent meta data shows positive ally synergy");
  }

  return { score, reasons, risks };
}

function findRuntimeName(id: number, runtimeByName?: Map<string, RuntimeHero>) {
  if (!runtimeByName) return "";
  for (const hero of runtimeByName.values()) {
    if (Number(hero.id) === id) return hero.name ?? "";
  }
  return "";
}

function recommendBoots(hero: any, enemies: any[]) {
  const ccEnemies = enemies.filter(hasCrowdControl).length;
  if (ccEnemies >= 3) {
    return { boots: "Tough Boots" as const, reason: "Enemy draft has heavy control" };
  }
  const physicalEnemies = enemies.filter((enemy) => isPhysicalDamage(enemy)).length;
  if (physicalEnemies >= 3) {
    return { boots: "Warrior Boots" as const, reason: "Enemy damage is physical-heavy" };
  }
  if (isMagicDamage(hero)) return { boots: "Arcane Boots" as const, reason: "Magic jungle damage profile" };
  if (rolesOf(hero).includes("marksman") || hasAny(tagsOf(hero), ["push", "attack speed"])) {
    return { boots: "Swift Boots" as const, reason: "Basic-attack scaling profile" };
  }
  return { boots: "Magic Shoes" as const, reason: "Cooldown value for jungle tempo" };
}

function recommendBlessing(hero: any) {
  if (hasFrontline(hero) || hasSustain(hero)) {
    return { blessing: "Bloody" as const, reason: "Sustain value in extended fights" };
  }
  if (hasBurst(hero)) return { blessing: "Flame" as const, reason: "Burst and pickoff pressure" };
  return { blessing: "Ice" as const, reason: "Chase and disengage utility" };
}

function clampScore(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function unique(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}

export function recommendJunglers(allHeroes: any[], context: RecommendationContext): JunglerRecommendation[] {
  const selectedLane = laneKey(context.selectedLane);
  const comfortPool = new Set((context.heroPool ?? []).map(normalize));
  return allHeroes
    .map((hero) => {
      const runtimeHero = context.runtimeByName?.get(normalize(compactName(hero)));
      return { hero, runtimeHero };
    })
    .filter(({ hero, runtimeHero }) => {
      const id = heroId(hero);
      const name = compactName(hero);
      if (context.unavailable.has(normalize(id)) || context.unavailable.has(normalize(name))) return false;
      return lanesOf(hero, runtimeHero).includes("jungle");
    })
    .map(({ hero, runtimeHero }) => {
      const meta = metaComponent(runtimeHero);
      const team = teamBalanceComponent(hero, context.allies);
      const enemy = enemyFitComponent(hero, context.enemies);
      const relations = relationComponent(hero, runtimeHero, context.allies, context.enemies, context.runtimeByName);
      const name = compactName(hero);
      const comfort = comfortPool.has(normalize(name)) ? 10 : comfortPool.size ? -5 : 0;
      const laneAdjustment = selectedLane && selectedLane !== "jungle" ? -8 : selectedLane === "jungle" ? 5 : 0;
      const score = clampScore(58 + meta + team.score + enemy.score + relations.score + comfort + laneAdjustment);
      const risks = unique([
        ...team.risks,
        ...enemy.risks,
        ...relations.risks,
        ...(selectedLane && selectedLane !== "jungle" ? [`Detected lane is ${selectedLane}; use this only if you are switching to jungle`] : [])
      ]);
      const reasons = unique([
        ...(comfort > 0 ? ["Comfort-pick match"] : []),
        ...(selectedLane === "jungle" ? [context.laneDetected ? "Fits detected jungle lane" : "Fits preferred jungle lane"] : []),
        ...team.reasons,
        ...enemy.reasons,
        ...relations.reasons,
        ...(meta > 5 ? ["Strong current meta signal"] : [])
      ]);
      if (!reasons.length) reasons.push("Stable jungle option for the current draft");
      const boots = recommendBoots(hero, context.enemies);
      const blessing = recommendBlessing(hero);
      const confidence: JunglerRecommendation["confidence"] = score >= 78 ? "high" : score >= 64 ? "medium" : "low";
      const highRisk = relations.score < 0 || risks.some((risk) => /control|counters|detected lane/i.test(risk));
      const warningLevel: JunglerRecommendation["warningLevel"] = highRisk ? "high" : risks.length ? "medium" : "none";
      return {
        heroId: heroId(hero),
        hero: name,
        score,
        confidence,
        style: classifyStyle(hero),
        breakdown: {
          meta: Math.round(meta),
          teamBalance: Math.round(team.score),
          enemyFit: Math.round(enemy.score),
          relations: Math.round(relations.score),
          comfort: Math.round(comfort + laneAdjustment)
        },
        reasons: reasons.slice(0, 5),
        risks: risks.slice(0, 4),
        warningLevel,
        boots: {
          boots: boots.boots,
          reason: boots.reason,
          blessing: blessing.blessing,
          blessingReason: blessing.reason
        }
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 8);
}
