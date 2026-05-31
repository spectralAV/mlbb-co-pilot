import { AlertTriangle } from "lucide-react";
import type { GankRiskOutput } from "../../lib/gameTypes";
import { highestRiskLane, laneLabels, lanes, normalizeGankRisk, riskMeterScore, zoneLabels } from "../../lib/gameUi";
import { GamePanel, RiskBadge } from "./GameShell";

export function GankRiskPanel({ risk }: { risk: GankRiskOutput }) {
  const safeRisk = normalizeGankRisk(risk);
  const highestLane = highestRiskLane(safeRisk);
  const visibleZones: GankRiskOutput["mapZones"] = safeRisk.mapZones.length ? safeRisk.mapZones : [{
    zone: safeRisk.recommendation.targetZone ?? "objective_pit",
    risk: safeRisk.recommendation.confidence === "high" ? "high" : "medium",
    reason: "Primary rotation target"
  }];

  return <GamePanel title="Gank Risk" icon={AlertTriangle} actions={<RiskBadge risk={highestLane.risk}>{laneLabels[highestLane.lane]} focus</RiskBadge>}>
    <div className="gank-risk-list">
      {lanes.map((lane) => {
        const laneRisk = safeRisk.lanes[lane].risk;
        const score = riskMeterScore[laneRisk];
        return <div key={lane} className={`gank-risk-card gank-risk-card-${laneRisk}`}>
          <div className="gank-risk-card-head">
            <div>
              <b>{laneLabels[lane]}</b>
              <span>{safeRisk.lanes[lane].reasons[0] ?? "No major pressure signal."}</span>
            </div>
            <RiskBadge risk={laneRisk}>{laneRisk}</RiskBadge>
          </div>
          <div className="gank-risk-meter" aria-hidden="true"><span style={{ width: `${score}%` }} /></div>
        </div>;
      })}
      <div className="gank-risk-recommendation">
        <span>Recommended call</span>
        <strong>{safeRisk.recommendation.text}</strong>
      </div>
      <div className="gank-risk-zones">
        <span>Hot zones</span>
        {visibleZones.slice(0, 3).map((zone) => <div key={`${zone.zone}-${zone.reason}`} className="gank-risk-zone-row">
          <div>
            <b>{zoneLabels[zone.zone]}</b>
            <em>{zone.reason}</em>
          </div>
          <RiskBadge risk={zone.risk}>{zone.risk}</RiskBadge>
        </div>)}
      </div>
    </div>
  </GamePanel>;
}
