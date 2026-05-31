import { ChevronRight, Map, Route } from "lucide-react";
import type { GameState, GankRiskOutput, MapZoneId, ZoneStatus } from "../../lib/gameTypes";
import { GamePanel, RiskBadge } from "./GameShell";
import { BattlefieldMap } from "./BattlefieldMap";
import { useCaptureRuntimeStore } from "../../runtime/captureRuntime";

const nextStatus: Record<ZoneStatus, ZoneStatus> = {
  unknown: "safe",
  safe: "danger",
  danger: "contested",
  contested: "objective",
  objective: "unknown"
};

const statusLabels: Array<{ status: ZoneStatus; label: string }> = [
  { status: "safe", label: "Safe" },
  { status: "danger", label: "Danger" },
  { status: "contested", label: "Contested" },
  { status: "objective", label: "Objective" }
];

export function MiniMapControl({ state, risk, onChange }: { state: GameState; risk?: GankRiskOutput; onChange: (patch: Partial<GameState>) => void }) {
  const minimapDetections = useCaptureRuntimeStore((store) => store.minimapDetections);
  const visibleDetections = minimapDetections.length;
  const nextObjective = (state.objectiveTimers.turtle ?? 999) < 90 ? "Turtle window" : (state.objectiveTimers.lord ?? 999) < 120 ? "Lord window" : "Map pressure";
  const confidenceRisk = state.enemyMissing.roam || state.enemyMissing.jungler ? "high" : "low";
  const contestedZones = state.mapZones.filter((zone) => zone.status === "danger" || zone.status === "contested").length;

  function cycle(id: MapZoneId) {
    onChange({
      mapZones: state.mapZones.map((zone) => zone.id === id ? { ...zone, status: nextStatus[zone.status], lastUpdatedAt: Date.now() } : zone)
    });
  }

  return <GamePanel
    title="Tactical Map"
    icon={Map}
    className="game-map-panel"
    bodyClassName="game-map-panel-body"
    actions={<RiskBadge risk={confidenceRisk}>{visibleDetections} live pings</RiskBadge>}
  >
    <div className="game-map-shell">
      <div className="game-map-status-row">
        <div>
          <span>Call</span>
          <strong>{nextObjective}</strong>
        </div>
        <div>
          <span>Roam</span>
          <strong>{state.enemyMissing.roam ? "Missing" : "Seen"}</strong>
        </div>
        <div>
          <span>Jungle</span>
          <strong>{state.enemyMissing.jungler ? "Fogged" : "Tracked"}</strong>
        </div>
      </div>
      <BattlefieldMap states={state.mapZones} riskZones={risk?.mapZones} markers={minimapDetections} onZoneClick={cycle} />
      <div className="game-map-route">
        <Route className="h-4 w-4" />
        <span>Red to Mid to Turtle</span>
        <ChevronRight className="h-4 w-4 animate-pulse" />
      </div>
      <div className="game-map-legend" aria-label="Map zone state legend">
        {statusLabels.map((item) => <span key={item.status} className={`game-map-legend-item game-map-legend-${item.status}`}>{item.label}</span>)}
        <b>{contestedZones} hot</b>
      </div>
      <div className="game-map-confidence">
        <div className="flex items-center justify-between gap-2">
          <span>Info confidence</span>
          <RiskBadge risk={confidenceRisk}>{state.enemyMissing.roam ? "roam stale" : "fresh"}</RiskBadge>
        </div>
        <div className="game-map-confidence-meter"><span style={{ width: state.enemyMissing.roam ? "52%" : "76%" }} /></div>
      </div>
    </div>
  </GamePanel>;
}
