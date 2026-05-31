import { useEffect, useMemo, useRef, useState } from "react";
import { getLatestLiveVision } from "../api/client";
import { analyzeGankRisk } from "../lib/gankRiskEngine";
import { disconnectedStatus, gameObservationFromLiveVision, mergeObservationIntoGameState, type GameObservation } from "../lib/gameObservation";
import { defaultGameState, type GameState } from "../lib/gameTypes";
import { highestRiskLane, laneLabels, normalizeCoaching, normalizeGankRisk } from "../lib/gameUi";
import { readLiveGameState, subscribeLiveGameState } from "../lib/liveGameStateStore";
import { getLiveCoaching } from "../lib/liveCoachingEngine";
import { RiskBadge } from "../components/game/GameShell";

export function GameOverlay() {
  const [state, setState] = useState(() => readLiveGameState() ?? defaultGameState());
  const latestObservation = useRef<GameObservation | null>(null);
  const risk = useMemo(() => analyzeGankRisk(state), [state]);
  const safeRisk = useMemo(() => normalizeGankRisk(risk), [risk]);
  const coaching = useMemo(() => normalizeCoaching(getLiveCoaching(state, safeRisk)), [state, safeRisk]);
  const highestLane = highestRiskLane(safeRisk);
  const objectiveTimers = [
    typeof state.objectiveTimers.turtle === "number" ? { label: "Turtle", seconds: state.objectiveTimers.turtle } : null,
    typeof state.objectiveTimers.lord === "number" ? { label: "Lord", seconds: state.objectiveTimers.lord } : null
  ].filter((timer): timer is { label: "Turtle" | "Lord"; seconds: number } => Boolean(timer)).sort((a, b) => a.seconds - b.seconds);
  const objective = objectiveTimers[0];
  const objectiveLabel = objective ? `${objective.label} ${objective.seconds}s` : "Objective ready";
  const objectiveRisk = (objective?.seconds ?? 999) < 45 ? "high" : "medium";
  const cvUnreliable = Boolean(state.cv?.connected && (state.cv.confidence === "low" || state.cv.stale || (state.cv.screenType === "live_hud" && !state.cv.minimapRecognized)));
  const topWarning = cvUnreliable ? "CV uncertain. Trust manual calls." : coaching.warnings[0] ?? "No urgent warning.";

  useEffect(() => {
    document.body.classList.add("obs-overlay-active");
    const applyLatestObservation = (stored: GameState) => latestObservation.current
      ? mergeObservationIntoGameState(stored, latestObservation.current)
      : stored;
    const unsubscribe = subscribeLiveGameState((stored) => setState(applyLatestObservation(stored)));
    const interval = window.setInterval(() => {
      const stored = readLiveGameState();
      if (stored) setState(applyLatestObservation(stored));
    }, 1000);
    async function refreshVision() {
      try {
        const result = await getLatestLiveVision();
        const observation = gameObservationFromLiveVision(result);
        if (observation) {
          latestObservation.current = observation;
          setState((current) => mergeObservationIntoGameState(current, observation));
        }
      } catch {
        latestObservation.current = null;
        setState((current) => current.cv?.connected ? { ...current, cv: disconnectedStatus() } : current);
      }
    }
    void refreshVision();
    const visionInterval = window.setInterval(refreshVision, 1200);
    return () => {
      unsubscribe();
      window.clearInterval(interval);
      window.clearInterval(visionInterval);
      document.body.classList.remove("obs-overlay-active");
    };
  }, []);

  return <main className="obs-overlay-page">
    <section className="obs-overlay-bar">
      <div className="obs-overlay-next">
        <span>Next</span>
        <strong>{coaching.mainAction}</strong>
      </div>
      <div className="obs-overlay-pills">
        <RiskBadge risk={objectiveRisk}>{objectiveLabel}</RiskBadge>
        <RiskBadge risk={highestLane.risk}>{laneLabels[highestLane.lane]} {highestLane.risk}</RiskBadge>
      </div>
      <div className="obs-overlay-warning">
        <span>Risk</span>
        <strong>{topWarning}</strong>
      </div>
    </section>
  </main>;
}
