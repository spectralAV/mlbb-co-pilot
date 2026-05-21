import { useMemo, useState } from "react";
import { BarChart3, Eye, PauseCircle } from "lucide-react";
import { GamePanel, RiskBadge } from "../components/game/GameShell";
import { listGameSessions, saveSessionNote } from "../lib/gameSessionStore";
import { formatMatchTime, type GameSession } from "../lib/gameTypes";

function sessionDuration(session: GameSession) {
  const end = session.endedAt ?? Date.now();
  return formatMatchTime(Math.round((end - session.startedAt) / 1000));
}

export function GameAnalysis() {
  const [sessions, setSessions] = useState(() => listGameSessions());
  const [selectedId, setSelectedId] = useState(() => sessions[0]?.id ?? "");
  const [note, setNote] = useState("");
  const selected = useMemo(() => sessions.find((session) => session.id === selectedId) ?? sessions[0] ?? null, [sessions, selectedId]);
  const latestRisk = selected?.gankRiskSnapshots[0];
  const latestCoaching = selected?.coachingSnapshots[0];

  function addNote() {
    if (!selected || !note.trim()) return;
    saveSessionNote(selected.id, note);
    setNote("");
    setSessions(listGameSessions());
  }

  return <div className="space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-white/10 bg-slate-900 p-4">
      <div>
        <div className="text-xs font-bold uppercase tracking-[0.25em] text-purple-300">Busy Gameplay Analysis</div>
        <h2 className="mt-1 text-3xl font-black text-white">{selected ? `${selected.hero ?? "Hero"} ${selected.role.toUpperCase()} / Session Review` : "No Session Yet"}</h2>
      </div>
      <div className="flex gap-2">
        <RiskBadge risk={selected?.endedAt ? "medium" : "high"}>{selected?.endedAt ? "Review" : "Recording"}</RiskBadge>
        <RiskBadge risk="medium">{selected?.events.length ?? 0} Events</RiskBadge>
      </div>
    </div>

    <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
      <GamePanel title="Sessions" icon={PauseCircle} className="xl:col-span-3">
        <div className="space-y-2">
          {sessions.map((session) => <button key={session.id} className={`w-full rounded-lg border px-3 py-2 text-left text-sm ${selected?.id === session.id ? "border-cyan-400/50 bg-cyan-500/10" : "border-white/10 bg-slate-950/60"}`} onClick={() => setSelectedId(session.id)}>
            <b>{session.hero ?? "Hero"} / {session.role}</b>
            <div className="text-xs text-slate-400">{new Date(session.startedAt).toLocaleString()} / {sessionDuration(session)}</div>
          </button>)}
          {!sessions.length && <p className="text-sm text-slate-400">Start a Busy Recording on the Game page to create a review session.</p>}
        </div>
      </GamePanel>

      <GamePanel title="Match Timeline" icon={PauseCircle} className="xl:col-span-4">
        <div className="max-h-[520px] space-y-3 overflow-auto">
          {(selected?.events ?? []).map((event) => <div key={event.id} className="flex gap-3 rounded-lg border border-white/10 bg-slate-950/70 p-3">
            <RiskBadge risk={event.type === "death" || event.type === "fight_lost" ? "high" : "medium"}>{event.matchTime ?? "--:--"}</RiskBadge>
            <div className="text-sm text-slate-200">{event.label}</div>
          </div>)}
          {selected && !selected.events.length && <p className="text-sm text-slate-400">No markers yet.</p>}
        </div>
      </GamePanel>

      <GamePanel title="Analysis Summary" icon={BarChart3} className="xl:col-span-3">
        <div className="space-y-3 text-sm text-slate-200">
          <div className="rounded-lg border border-red-400/30 bg-red-500/10 p-3"><b>Biggest risk:</b> {latestRisk?.warnings[0] ?? "No risk snapshot yet."}</div>
          <div className="rounded-lg border border-yellow-400/30 bg-yellow-500/10 p-3"><b>Missed window:</b> {latestCoaching?.reason ?? "Capture more snapshots during play."}</div>
          <div className="rounded-lg border border-cyan-400/30 bg-cyan-500/10 p-3"><b>Best next habit:</b> Track enemy roam before river entry.</div>
          <div className="rounded-lg border border-white/10 bg-slate-950/70 p-3"><b>Recommendation:</b> {latestCoaching?.mainAction ?? "Start recording and add quick events."}</div>
        </div>
      </GamePanel>

      <GamePanel title="Post-Match Notes" icon={Eye} className="xl:col-span-2">
        <textarea className="input h-40 w-full text-sm" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Add note..." />
        <button className="btn mt-2 w-full" disabled={!selected || !note.trim()} onClick={addNote}>Save Note</button>
        <div className="mt-3 space-y-2 text-xs text-slate-300">{(selected?.notes ?? []).map((item) => <div key={item} className="rounded-lg bg-white/5 p-2">{item}</div>)}</div>
      </GamePanel>
    </div>
  </div>;
}
