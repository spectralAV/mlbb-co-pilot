import { matchupQuality } from "./counterEngine.js";
import { rankDraftSignal, roneHeroSignal } from "./roneDraftSignals.js";
import { teamSynergy } from "./synergyEngine.js";
import type { HeroPerformance } from "../services/playerProfile.js";

function normalize(value: unknown) {
  return String(value ?? "").toLowerCase();
}

function clamp(score: number) {
  return Math.max(0, Math.min(100, Math.round(score)));
}

function metaScore(hero: any, runtimeHero?: any) {
  const winRate = Number(runtimeHero?.meta?.winRate ?? hero?.meta?.winRate ?? 0);
  const appearanceRate = Number(runtimeHero?.meta?.appearanceRate ?? 0);
  if (winRate > 0) return clamp(45 + winRate / 2 + appearanceRate / 10);
  return 55;
}

function flexibilityScore(hero: any, runtimeHero?: any) {
  const roles = hero?.roles ?? runtimeHero?.roles ?? [];
  const lanes = hero?.lanes ?? runtimeHero?.lanes ?? [];
  const count = (Array.isArray(roles) ? roles.length : 0) + (Array.isArray(lanes) ? lanes.length : 0);
  return clamp(45 + count * 8);
}

function laneKey(value: unknown) {
  return normalize(value).replace(/\s+lane$/, "");
}

export function scoreDraftHero(hero: any, context: { allies: any[]; enemies: any[]; heroPool: string[]; role?: string; lane?: string; laneDetected?: boolean; runtimeHero?: any; rankProfile?: string; heroPerformance?: HeroPerformance[] }) {
  const matchup = matchupQuality(hero, context.enemies);
  const synergy = teamSynergy(hero, context.allies);
  const name = normalize(hero?.name ?? hero?.hero_name);
  const pool = context.heroPool.map(normalize);
  const comfort = pool.length === 0 ? 60 : pool.includes(name) ? 95 : 35;
  const meta = metaScore(hero, context.runtimeHero);
  const flexibility = flexibilityScore(hero, context.runtimeHero);
  const roneSignal = roneHeroSignal(name, context.heroPerformance);
  const rankSignal = rankDraftSignal(context.rankProfile, meta, matchup.score);
  const roleText = normalize([hero?.role, ...(hero?.roles ?? []).map((r: any) => r?.title ?? r)].join(" "));
  const rolePenalty = context.role && roleText && !roleText.includes(normalize(context.role)) ? 6 : 0;
  const heroLanes = (hero?.lanes ?? context.runtimeHero?.lanes ?? []).map((lane: any) => laneKey(lane?.title ?? lane));
  const requestedLane = laneKey(context.lane);
  const laneMatches = Boolean(requestedLane) && heroLanes.includes(requestedLane);
  const laneAdjustment = requestedLane ? laneMatches ? 12 : -18 : 0;
  const score = clamp(
    matchup.score * 0.35
    + comfort * 0.25
    + synergy.score * 0.2
    + meta * 0.1
    + flexibility * 0.1
    - rolePenalty
    + laneAdjustment
    + (roneSignal?.adjustment ?? 0)
    + rankSignal.adjustment
  );
  const reasons = [...matchup.reasons, ...synergy.reasons];
  if (rankSignal.reason) reasons.push(rankSignal.reason);
  if (roneSignal?.reason) reasons.unshift(roneSignal.reason);
  if (roneSignal?.secondaryReason) reasons.push(roneSignal.secondaryReason);
  if (pool.includes(name)) reasons.unshift("Good comfort-pick match");
  if (laneMatches) reasons.unshift(`Fits ${context.laneDetected ? "detected" : "preferred"} ${requestedLane} lane`);
  if (meta >= 65) reasons.push("Strong current meta profile");
  const risks = [...matchup.risks];
  if (requestedLane && !laneMatches) risks.unshift(`Does not match ${context.laneDetected ? "detected" : "preferred"} ${requestedLane} lane`);
  if (roneSignal?.risk) risks.push(roneSignal.risk);
  if (rankSignal.risk) risks.push(rankSignal.risk);
  if (!reasons.length) reasons.push("Balanced fit for the current draft");

  return {
    hero: hero?.name ?? hero?.hero_name ?? "Unknown Hero",
    score,
    confidence: score >= 80 ? "high" : score >= 65 ? "medium" : "low",
    reasons: reasons.slice(0, 5),
    risks
  };
}
