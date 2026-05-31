import { PauseCircle } from "lucide-react";
import type { GameEvent, GameSession } from "../../lib/gameTypes";
import { GamePanel, RiskBadge } from "./GameShell";

export function BusyModeRecorder({ session, events }: { session: GameSession | null; events: GameEvent[] }) {
  return <GamePanel title="Busy Timeline" icon={PauseCircle} actions={<RiskBadge risk={session ? "high" : "medium"}>{session ? "REC" : "PAUSED"}</RiskBadge>}>
    <div className="busy-recorder-head">
      <div>
        <div className="text-sm font-bold text-white">{session ? "Recording session" : "No active session"}</div>
        <div className="text-xs text-slate-400">{events.length} events captured</div>
      </div>
    </div>
    <div className="busy-recorder-timeline">
      {events.slice(0, 7).map((event) => <div key={event.id} className="busy-recorder-event">
        <span>{event.matchTime ?? "--:--"}</span>
        <b>{event.label}</b>
        <small>{[event.source ?? "manual", event.confidence].filter(Boolean).join(" / ")}</small>
      </div>)}
      {!events.length && <div className="busy-recorder-empty">Use quick events to build the review timeline.</div>}
    </div>
  </GamePanel>;
}
