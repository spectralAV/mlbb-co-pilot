import { PauseCircle } from "lucide-react";
import type { GameEvent, GameSession } from "../../lib/gameTypes";
import { GamePanel, RiskBadge } from "./GameShell";

export function BusyModeRecorder({ session, events }: { session: GameSession | null; events: GameEvent[] }) {
  return <GamePanel title="Busy Recorder" icon={PauseCircle}>
    <div className="flex items-center justify-between gap-3">
      <div>
        <div className="text-sm font-bold text-white">{session ? "Recording session" : "No active session"}</div>
        <div className="text-xs text-slate-400">{events.length} manual markers captured</div>
      </div>
      <RiskBadge risk={session ? "high" : "medium"}>{session ? "REC" : "PAUSED"}</RiskBadge>
    </div>
    <div className="mt-3 max-h-48 space-y-2 overflow-auto">
      {events.slice(0, 6).map((event) => <div key={event.id} className="rounded-lg border border-white/10 bg-slate-950/60 p-2 text-xs"><b>{event.matchTime}</b> / {event.label}</div>)}
      {!events.length && <div className="text-sm text-slate-400">Use quick events to build the review timeline.</div>}
    </div>
  </GamePanel>;
}
