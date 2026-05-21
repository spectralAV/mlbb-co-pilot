import { useMemo, useState } from "react";
import { analyzeGankRisk } from "../lib/gankRiskEngine";
import { defaultGameState } from "../lib/gameTypes";
import { getLiveCoaching } from "../lib/liveCoachingEngine";
import { RiskBadge } from "../components/game/GameShell";

export function GameOverlay() {
  const [state] = useState(() => defaultGameState());
  const risk = useMemo(() => analyzeGankRisk(state), [state]);
  const coaching = useMemo(() => getLiveCoaching(state, risk), [state, risk]);
  const goldRisk = risk.lanes.gold.risk;

  return <main className="min-h-screen bg-transparent p-5 text-white">
    <section className="mx-auto max-w-5xl rounded-2xl border border-white/10 bg-slate-950/95 p-5 shadow-2xl">
      <div className="grid grid-cols-1 items-center gap-4 md:grid-cols-12">
        <div className="md:col-span-5">
          <div className="text-xs font-bold uppercase tracking-[0.25em] text-cyan-300">OBS Compact Overlay</div>
          <div className="mt-2 text-4xl font-black text-white">NEXT: {coaching.mainAction}</div>
          <div className="mt-2 text-slate-300">{coaching.reason}</div>
        </div>
        <div className="grid grid-cols-2 gap-2 md:col-span-3">
          <RiskBadge risk={(state.objectiveTimers.turtle ?? 999) < 45 ? "high" : "medium"}>Turtle {state.objectiveTimers.turtle}s</RiskBadge>
          <RiskBadge risk={goldRisk}>Gold {goldRisk}</RiskBadge>
          <RiskBadge risk={state.enemyMissing.roam ? "critical" : "low"}>Roam {state.enemyMissing.roam ? "Missing" : "Seen"}</RiskBadge>
          <RiskBadge risk={coaching.priority === "urgent" ? "critical" : coaching.priority === "high" ? "high" : "medium"}>{coaching.mode}</RiskBadge>
        </div>
        <div className="rounded-lg border border-red-400/30 bg-red-500/10 p-4 md:col-span-4">
          <div className="text-xs font-bold uppercase tracking-widest text-red-300">Risk</div>
          <div className="mt-2 text-2xl font-black">{coaching.warnings[0] ?? "No urgent warning."}</div>
        </div>
      </div>
    </section>
  </main>;
}
