import { Radio } from "lucide-react";
import type { CvGameStatus, Risk } from "../../lib/gameTypes";
import { GamePanel, RiskBadge } from "./GameShell";

function riskForConfidence(confidence?: CvGameStatus["confidence"]): Risk {
  if (confidence === "high") return "low";
  if (confidence === "medium") return "medium";
  return "high";
}

function ageLabel(timestamp?: number) {
  if (!timestamp) return "never";
  const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
  return seconds < 1 ? "now" : `${seconds}s ago`;
}

export function CvStatusPanel({ cv }: { cv?: CvGameStatus }) {
  const connected = Boolean(cv?.connected);
  const confidence = cv?.confidence ?? "low";
  return <GamePanel title="CV Signal" icon={Radio} actions={<RiskBadge risk={connected ? riskForConfidence(confidence) : "high"}>{connected ? confidence : "offline"}</RiskBadge>}>
    <div className="cv-status-grid">
      <div><span>Status</span><b>{connected ? "Connected" : "Disconnected"}</b></div>
      <div><span>Last obs</span><b>{ageLabel(cv?.lastObservationAt)}</b></div>
      <div><span>Screen</span><b>{(cv?.screenType ?? "unknown").replace(/_/g, " ")}</b></div>
      <div><span>Minimap</span><b>{cv?.minimapRecognized ? "Recognized" : "Uncertain"}</b></div>
      <div><span>Enemies</span><b>{cv?.visibleEnemies ?? 0} visible</b></div>
      <div><span>Source</span><b>{cv?.source ?? "hybrid"}</b></div>
    </div>
    {cv?.warning && <div className="cv-status-warning">{cv.warning}</div>}
  </GamePanel>;
}
