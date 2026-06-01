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

function normalizedGrade(value: unknown) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  return parsed > 20 ? parsed / 100 : parsed;
}

function displayGrade(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "";
  return value.toFixed(1).replace(/\.0$/, "");
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
  const averageGrade = normalizedGrade(performance.averageGrade ?? performance.bestScore);
  const bestScore = Number(performance.bestScore ?? 0);
  const bestGrade = normalizedGrade(bestScore);
  const gradeSignal = averageGrade || bestGrade;
  const gradeAdjustment = gradeSignal > 0 ? clamp((gradeSignal - 7.2) * 18, -18, 24) : 0;
  const winRateAdjustment = gradeSignal > 0
    ? clamp((winRate - 50) * 0.12 * sampleConfidence, -4, 4)
    : (winRate - 50) * sampleConfidence;
  const profileScore = clamp(55 + sampleComfort + gradeAdjustment + winRateAdjustment, 0, 100);
  const isOverallFallback = performance.scope === "overall";
  const adjustment = clamp((profileScore - 60) * 0.38 * (isOverallFallback ? 0.72 : 1), -12, 14);
  const gradeText = displayGrade(gradeSignal);
  const bestScoreText = !gradeText ? displayScore(bestScore) : "";
  const label = performance.scope === "current-season" ? "RONE current season" : performance.scope === "overall" ? "RONE overall mechanics" : "RONE profile";
  const overallWinRate = overall ? clamp(Number(overall.winRate) || 0, 0, 100) : 0;
  const overallGrade = normalizedGrade(overall?.averageGrade ?? overall?.bestScore);
  const currentGradeBeatsHistory = performance.scope === "current-season" && gradeSignal > 0 && overallGrade > 0 && gradeSignal >= overallGrade + 0.6;
  const currentWinRateBeatsHistory = performance.scope === "current-season" && gradeSignal <= 0 && winRate >= 60 && overall && overallWinRate > 0 && overallWinRate + 8 < winRate;

  return {
    matches,
    winRate,
    averageGrade: gradeSignal > 0 ? gradeSignal : undefined,
    bestScore: bestScore > 0 ? bestScore : undefined,
    profileScore,
    adjustment,
    reason: `${label}: ${matches} matches${gradeText ? ` / ${gradeText} grade` : bestScoreText ? ` / ${bestScoreText} score` : ""} / ${displayWinRate(winRate)} WR`,
    secondaryReason: currentGradeBeatsHistory
      ? `Current season grade overrides ${displayGrade(overallGrade)} overall grade`
      : currentWinRateBeatsHistory
        ? `Current season form overrides ${displayWinRate(overallWinRate)} overall WR`
        : "",
    risk: matches >= 8 && gradeSignal > 0 && gradeSignal < 6.8
      ? `${label} grade is only ${displayGrade(gradeSignal)} on this hero`
      : matches >= 8 && gradeSignal <= 0 && winRate < 47
        ? `${label} is only ${displayWinRate(winRate)} WR on this hero`
        : "",
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
