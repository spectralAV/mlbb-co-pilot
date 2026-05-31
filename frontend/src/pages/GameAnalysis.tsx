import { useMemo, useState } from "react";
import { BarChart3, Clock3, Eye, PauseCircle } from "lucide-react";
import { GamePanel, RiskBadge } from "../components/game/GameShell";
import { listGameSessions, saveSessionNote } from "../lib/gameSessionStore";
import { eventRisk, normalizeCoaching, normalizeGankRisk, riskRank, safeSessionEvents, safeSessionNotes } from "../lib/gameUi";
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
  const events = safeSessionEvents(selected);
  const latestRisk = selected?.gankRiskSnapshots?.[0] ? normalizeGankRisk(selected.gankRiskSnapshots[0]) : null;
  const latestCoaching = selected?.coachingSnapshots?.[0] ? normalizeCoaching(selected.coachingSnapshots[0]) : null;
  const riskSpikeEvents = events.filter((event) => riskRank[eventRisk(event)] >= riskRank.high).slice(0, 3);
  const objectiveEvents = events.filter((event) => event.type === "objective_taken").slice(0, 3);
  const badFightEvents = events.filter((event) => event.type === "death" || event.type === "fight_lost").slice(0, 3);
  const riskSpikeText = riskSpikeEvents.length
    ? riskSpikeEvents.map((event) => `${event.matchTime ?? "--:--"} ${event.label}`).join(" / ")
    : latestRisk?.warnings.slice(0, 2).join(" / ") || "No risk spikes captured yet.";
  const objectiveMistakeText = objectiveEvents.length
    ? objectiveEvents.map((event) => `${event.matchTime ?? "--:--"} ${event.label}`).join(" / ")
    : latestRisk?.mapZones[0]?.reason || "No objective mistakes captured yet.";
  const badFightText = badFightEvents.length
    ? badFightEvents.map((event) => `${event.matchTime ?? "--:--"} ${event.label}`).join(" / ")
    : "No death or lost-fight marker yet.";
  const trainingFocus = badFightEvents.length
    ? "Slow the next entry after missing enemy info."
    : objectiveEvents.length
      ? "Pre-position before objective timers expire."
      : riskSpikeEvents.length
        ? "Call missing enemies earlier before river moves."
        : "Record fights and objective windows for sharper review.";

  function addNote() {
    if (!selected || !note.trim()) return;
    saveSessionNote(selected.id, note);
    setNote("");
    setSessions(listGameSessions());
  }

  return <div className="game-analysis-page">
    <div className="game-analysis-hero">
      <div>
        <div className="game-kicker">Busy Gameplay Analysis</div>
        <h2>{selected ? `${selected.hero ?? "Hero"} ${selected.role.toUpperCase()} / Session Review` : "No Session Yet"}</h2>
      </div>
      <div className="flex gap-2">
        <RiskBadge risk={selected?.endedAt ? "medium" : "high"}>{selected?.endedAt ? "Review" : "Recording"}</RiskBadge>
        <RiskBadge risk="medium">{events.length} Events</RiskBadge>
      </div>
    </div>

    <div className="game-analysis-grid">
      <GamePanel title="Sessions" icon={PauseCircle} className="xl:col-span-3">
        <div className="space-y-2">
          {sessions.map((session) => <button key={session.id} className={`analysis-session-button ${selected?.id === session.id ? "analysis-session-button-active" : ""}`} onClick={() => setSelectedId(session.id)}>
            <b>{session.hero ?? "Hero"} / {session.role}</b>
            <div className="text-xs text-slate-400">{new Date(session.startedAt).toLocaleString()} / {sessionDuration(session)}</div>
          </button>)}
          {!sessions.length && <p className="text-sm text-slate-400">Start a Busy Recording on the Game page to create a review session.</p>}
        </div>
      </GamePanel>

      <GamePanel title="Match Timeline" icon={Clock3} className="xl:col-span-5" bodyClassName="analysis-timeline-body">
        <div className="analysis-timeline">
          {events.map((event) => <div key={event.id} className="analysis-timeline-item">
            <RiskBadge risk={eventRisk(event)}>{event.matchTime ?? "--:--"}</RiskBadge>
            <div>
              <b>{event.label}</b>
              <span>{event.zone ? event.zone.replace(/_/g, " ") : event.type.replace(/_/g, " ")}</span>
              <small>{[event.source ?? "manual", event.confidence].filter(Boolean).join(" / ")}</small>
            </div>
          </div>)}
          {selected && !selected.events.length && <p className="text-sm text-slate-400">No markers yet.</p>}
        </div>
      </GamePanel>

      <GamePanel title="Analysis Summary" icon={BarChart3} className="xl:col-span-2">
        <div className="analysis-summary-stack">
          <div><span>Biggest risk</span><b>{latestRisk?.warnings[0] ?? "No risk snapshot yet."}</b></div>
          <div><span>Risk spikes</span><b>{riskSpikeText}</b></div>
          <div><span>Missed objectives</span><b>{objectiveMistakeText}</b></div>
          <div><span>Deaths / bad fights</span><b>{badFightText}</b></div>
          <div><span>Training focus</span><b>{trainingFocus}</b></div>
          <div><span>Recommendation</span><b>{latestCoaching?.mainAction ?? "Start recording and add quick events."}</b></div>
        </div>
      </GamePanel>

      <GamePanel title="Post-Match Notes" icon={Eye} className="xl:col-span-2">
        <textarea className="input h-40 w-full text-sm" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Add note..." />
        <button className="btn mt-2 w-full" disabled={!selected || !note.trim()} onClick={addNote}>Save Note</button>
        <div className="mt-3 space-y-2 text-xs text-slate-300">{safeSessionNotes(selected).map((item) => <div key={item} className="rounded-lg bg-white/5 p-2">{item}</div>)}</div>
      </GamePanel>
    </div>
  </div>;
}
