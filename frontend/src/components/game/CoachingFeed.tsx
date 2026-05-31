import { AlertTriangle, Brain, Zap } from "lucide-react";
import type { LiveCoachingOutput } from "../../lib/gameTypes";
import { normalizeCoaching } from "../../lib/gameUi";
import { GamePanel, RiskBadge } from "./GameShell";

export function CoachingFeed({ coaching, compact = false }: { coaching: LiveCoachingOutput; compact?: boolean }) {
  const safeCoaching = normalizeCoaching(coaching);
  const priorityRisk = safeCoaching.priority === "urgent" ? "critical" : safeCoaching.priority === "high" ? "high" : safeCoaching.priority === "medium" ? "medium" : "low";
  const confidenceRisk = safeCoaching.confidence === "low" ? "high" : safeCoaching.confidence === "medium" ? "medium" : "low";
  const warnings = safeCoaching.warnings.length ? safeCoaching.warnings : ["No urgent warning."];
  const whyLines = safeCoaching.reason.split("\n").filter(Boolean).slice(0, 2);
  return <GamePanel title={compact ? "Coach" : "Coaching Feed"} icon={Brain} actions={<>
    <RiskBadge risk={priorityRisk}>{safeCoaching.priority}</RiskBadge>
    <RiskBadge risk={confidenceRisk}>{safeCoaching.confidence ?? "medium"} confidence</RiskBadge>
  </>}>
    <div className={`coaching-feed ${compact ? "coaching-feed-compact" : ""}`}>
      <div className={`coaching-next-card coaching-next-card-${safeCoaching.priority}`}>
        <div className="coaching-label"><Zap className="h-4 w-4" /> Next Move <RiskBadge risk={priorityRisk}>{safeCoaching.mode}</RiskBadge></div>
        <div className="coaching-action">{safeCoaching.mainAction}</div>
        <div className="coaching-why">
          <span>Why this call?</span>
          {whyLines.map((line) => <p key={line}>{line}</p>)}
        </div>
      </div>
      <div className="coaching-risk-card">
        <div className="coaching-label coaching-label-danger"><AlertTriangle className="h-4 w-4" /> Risk</div>
        <ul>
          {warnings.slice(0, 3).map((warning) => <li key={warning}>{warning}</li>)}
        </ul>
      </div>
    </div>
  </GamePanel>;
}
