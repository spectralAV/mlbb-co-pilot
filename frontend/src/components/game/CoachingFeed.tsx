import { AlertTriangle, Brain, Zap } from "lucide-react";
import type { LiveCoachingOutput } from "../../lib/gameTypes";
import { GamePanel, RiskBadge } from "./GameShell";

export function CoachingFeed({ coaching, compact = false }: { coaching: LiveCoachingOutput; compact?: boolean }) {
  const priorityRisk = coaching.priority === "urgent" ? "critical" : coaching.priority === "high" ? "high" : coaching.priority === "medium" ? "medium" : "low";
  return <GamePanel title="Coaching Feed" icon={Brain}>
    <div className="space-y-4">
      <div className="rounded-lg border border-cyan-400/30 bg-cyan-500/10 p-4">
        <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-cyan-300"><Zap className="h-4 w-4" /> Next Move <RiskBadge risk={priorityRisk}>{coaching.mode}</RiskBadge></div>
        <div className={`${compact ? "text-2xl" : "text-3xl"} mt-2 font-black leading-tight text-white`}>{coaching.mainAction}</div>
        <div className="mt-3 text-sm text-slate-300">{coaching.reason}</div>
      </div>
      <div className="rounded-lg border border-red-400/30 bg-red-500/10 p-4">
        <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-red-300"><AlertTriangle className="h-4 w-4" /> Risk</div>
        <ul className="mt-3 space-y-2 text-sm text-slate-200">
          {(coaching.warnings.length ? coaching.warnings : ["No urgent warning."]).slice(0, 3).map((warning) => <li key={warning}>{warning}</li>)}
        </ul>
      </div>
      {!compact && <div className="grid gap-2 sm:grid-cols-3"><RiskBadge risk="low">Farm</RiskBadge><RiskBadge risk="medium">Gank</RiskBadge><RiskBadge risk="high">Objective</RiskBadge></div>}
    </div>
  </GamePanel>;
}
