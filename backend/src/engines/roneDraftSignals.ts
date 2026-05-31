import type { HeroPerformance } from "../services/playerProfile.js";

function normalize(value: unknown) {
  return String(value ?? "").trim().toLowerCase();
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function displayWinRate(value: number) {
  return `${value.toFixed(1).replace(/\.0$/, "")}%`;
}

function displayScore(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "";
  const score = value > 20 ? value / 100 : value;
  return score.toFixed(1).replace(/\.0$/, "");
}

function heroEntries(heroName: unknown, heroPerformance: HeroPerformance[] = []) {
  const key = normalize(heroName);
  if (!key) return [];
  return heroPerformance.filter((entry) => normalize(entry.hero) === key);
}

export function ronePerformanceFor(heroName: unknown, heroPerformance: HeroPerformance[] = []) {
  const entries = heroEntries(heroName, heroPerformance);
  const current = entries.find((entry) => entry.scope === "current-season" && entry.matches > 0);
  const overall = entries.find((entry) => entry.scope === "overall" && entry.matches > 0);
  return current ?? overall ?? entries.find((entry) => entry.matches > 0) ?? null;
}

export function roneHeroSignal(heroName: unknown, heroPerformance: HeroPerformance[] = []) {
  const performance = ronePerformanceFor(heroName, heroPerformance);
  if (!performance || performance.matches <= 0) return null;
  const entries = heroEntries(heroName, heroPerformance);
  const overall = entries.find((entry) => entry.scope === "overall" && entry.matches > 0 && normalize(entry.hero) === normalize(performance.hero));

  const matches = Math.max(0, performance.matches);
  const winRate = clamp(Number(performance.winRate) || 0, 0, 100);
  const sampleConfidence = matches >= 20 ? 1 : matches >= 8 ? 0.65 : 0.35;
  const sampleComfort = matches >= 10 ? Math.min(8, Math.log2(matches) * 1.5) : Math.max(0, matches - 3) * 0.6;
  const bestScore = Number(performance.bestScore ?? 0);
  const shownBestScore = bestScore > 20 ? bestScore / 100 : bestScore;
  const bestScoreAdjustment = shownBestScore > 0 ? clamp((shownBestScore - 7.2) * 2.5, -4, 5) : 0;
  const profileScore = clamp(55 + (winRate - 50) * sampleConfidence + sampleComfort + bestScoreAdjustment, 0, 100);
  const isOverallFallback = performance.scope === "overall";
  const adjustment = clamp((profileScore - 60) * 0.38 * (isOverallFallback ? 0.72 : 1), -12, 14);
  const scoreText = displayScore(bestScore);
  const label = performance.scope === "current-season" ? "RONE current season" : performance.scope === "overall" ? "RONE overall mechanics" : "RONE profile";
  const overallWinRate = overall ? clamp(Number(overall.winRate) || 0, 0, 100) : 0;
  const currentBeatsHistory = performance.scope === "current-season" && winRate >= 60 && overall && overallWinRate > 0 && overallWinRate + 8 < winRate;

  return {
    matches,
    winRate,
    bestScore: bestScore > 0 ? bestScore : undefined,
    profileScore,
    adjustment,
    reason: `${label}: ${matches} matches / ${displayWinRate(winRate)} WR${scoreText ? ` / ${scoreText} best` : ""}`,
    secondaryReason: currentBeatsHistory ? `Current season form overrides ${displayWinRate(overallWinRate)} overall WR` : "",
    risk: matches >= 8 && winRate < 47 ? `${label} is only ${displayWinRate(winRate)} WR on this hero` : "",
  };
}

export function rankTier(rankProfile: unknown) {
  const text = normalize(rankProfile);
  if (!text) return 0;
  const stars = Number(text.match(/(\d+)\s*stars?/)?.[1] ?? 0);
  if (text.includes("immortal") || stars >= 100) return 5;
  if (text.includes("glory") || stars >= 50) return 4;
  if (text.includes("honor") || stars >= 25) return 3;
  if (text.includes("mythic")) return 2;
  if (text.includes("legend")) return 1;
  const rankLevel = Number(text.match(/rank\s+(\d+)/)?.[1] ?? 0);
  if (rankLevel >= 136) return 2;
  if (rankLevel >= 131) return 1;
  return 0;
}

export function rankDraftSignal(rankProfile: unknown, metaScore: number, matchupScore: number) {
  const tier = rankTier(rankProfile);
  if (tier < 3) return { adjustment: 0, reason: "", risk: "" };

  const pressure = clamp(tier / 4, 0.75, 1.25);
  const adjustment = clamp(((metaScore - 55) * 0.07 + (matchupScore - 55) * 0.04) * pressure, -5, 8);
  return {
    adjustment,
    reason: adjustment >= 3 ? "RONE rank profile favors this meta/matchup" : "",
    risk: adjustment <= -3 ? "RONE rank profile makes this weak meta/matchup riskier" : "",
  };
}
