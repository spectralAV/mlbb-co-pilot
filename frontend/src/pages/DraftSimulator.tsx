import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { CheckCircle2, XCircle } from "lucide-react";
import { FlaskConical, Play, RefreshCw, Smartphone } from "lucide-react";
import {
  draftSimulatorReferenceFrameUrl,
  getDraftSimulatorAssetsStatus,
  getDraftSimulatorReferenceFrames,
  getDraftSimulatorScenarios,
  replayDraftSimulatorScenario,
} from "../api/client";

function slotSummary(slots: Array<{ slot?: number; heroName?: string }> = []) {
  return slots.map((entry) => `${entry.slot}:${entry.heroName}`).join(", ") || "(empty)";
}

export function DraftSimulator() {
  const [selectedId, setSelectedId] = useState("");
  const scenariosQ = useQuery({ queryKey: ["draft-simulator-scenarios"], queryFn: getDraftSimulatorScenarios });
  const assetsQ = useQuery({ queryKey: ["draft-simulator-assets"], queryFn: getDraftSimulatorAssetsStatus });
  const framesQ = useQuery({ queryKey: ["draft-simulator-frames"], queryFn: getDraftSimulatorReferenceFrames });
  const replay = useMutation({
    mutationFn: (scenarioId: string) => replayDraftSimulatorScenario(scenarioId),
  });

  const scenarios = scenariosQ.data?.data ?? [];
  const activeId = selectedId || scenarios[0]?.id || "";
  const active = scenarios.find((item: { id: string; expect?: Record<string, unknown> }) => item.id === activeId);
  const referenceFrame = framesQ.data?.data?.find((frame: { id: string; available: boolean }) => frame.id === "last-adb" && frame.available);
  const replaySteps = replay.data?.data?.steps ?? [];
  const finalState = replay.data?.data?.latest?.state;
  const replayPassed = replay.data?.data?.passed;
  const replayFailures: string[] = replay.data?.data?.failures ?? [];
  const assetsReady = (assetsQ.data?.data?.manifest?.extraction?.textures ?? 0) >= 50;

  const assetHint = useMemo(() => {
    const manifest = assetsQ.data?.data?.manifest;
    if (!manifest) return "Pull game UI from Settings → Data Sync → Download Full UI (ADB).";
    const textures = manifest.extraction?.textures ?? 0;
    const ui = manifest.library?.uiDownloaded ?? 0;
    const total = manifest.inventory?.uiBundles ?? 0;
    return `${textures} extracted textures · ${ui}/${total} UI bundles local`;
  }, [assetsQ.data]);

  return <div className="space-y-5">
    <div>
      <h2 className="flex items-center gap-2 text-3xl font-black"><FlaskConical className="h-8 w-8 text-violet-300" />Draft Simulator</h2>
      <p className="mt-2 max-w-3xl text-slate-400">
        Replay draft lifecycle scenarios without a live 10-player lobby. Uses the same ingest path as Live Capture, plus ADB-pulled hero heads and UI textures for offline CV training.
      </p>
    </div>

    <div className="grid gap-4 xl:grid-cols-[minmax(280px,1fr)_minmax(320px,1.2fr)]">
      <div className="card space-y-4 p-4">
        <h3 className="font-bold">Lifecycle scenarios</h3>
        <p className="text-sm text-slate-400">
          Scripted frames from <code className="text-xs">data/recognition-samples/draft-lifecycle-scenarios.json</code>.
          Add scenarios with an <code className="text-xs">expect</code> block, then run <code className="text-xs">npm test -- tests/draftLifecycle.test.ts</code>.
        </p>
        <div className="space-y-2">
          {scenarios.map((scenario: { id: string; description: string; frameCount: number }) => (
            <button
              key={scenario.id}
              type="button"
              onClick={() => setSelectedId(scenario.id)}
              className={`w-full rounded-lg border p-3 text-left ${activeId === scenario.id ? "border-violet-400 bg-violet-500/15" : "border-white/10 bg-white/5 hover:bg-white/10"}`}
            >
              <div className="font-semibold">{scenario.id}</div>
              <div className="mt-1 text-xs text-slate-400">{scenario.description}</div>
              <div className="mt-2 text-xs text-slate-500">{scenario.frameCount} frames</div>
            </button>
          ))}
        </div>
        <button
          className="btn inline-flex w-full items-center justify-center gap-2"
          disabled={!activeId || replay.isPending}
          onClick={() => replay.mutate(activeId)}
        >
          {replay.isPending ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
          {replay.isPending ? "Replaying…" : "Replay scenario"}
        </button>
        {replay.error && <p className="text-sm text-red-200">{String((replay.error as Error).message)}</p>}
        {replay.isSuccess && typeof replayPassed === "boolean" && (
          <div className={`mt-3 flex items-start gap-2 rounded-lg border p-3 text-sm ${replayPassed ? "border-emerald-400/30 bg-emerald-500/10 text-emerald-100" : "border-rose-400/30 bg-rose-500/10 text-rose-100"}`}>
            {replayPassed ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> : <XCircle className="mt-0.5 h-4 w-4 shrink-0" />}
            <div>
              <div className="font-semibold">{replayPassed ? "Scenario passed" : "Scenario failed"}</div>
              {!replayPassed && replayFailures.length > 0 && (
                <ul className="mt-1 list-inside list-disc text-xs opacity-90">
                  {replayFailures.map((line) => <li key={line}>{line}</li>)}
                </ul>
              )}
            </div>
          </div>
        )}
        {!assetsReady && (
          <p className="mt-2 text-sm text-amber-200/90">
            ADB draft assets look thin — <Link className="underline" to="/setup">open Setup</Link> or Settings → Data Sync to index hero textures.
          </p>
        )}
        <p className="text-xs text-slate-500">Open <Link className="text-cyan-300 underline" to="/draft">Draft Room</Link> with Realtime on to see the final roster after replay.</p>
      </div>

      <div className="space-y-4">
        <div className="card p-4">
          <h3 className="mb-2 font-bold">Replay trace</h3>
          {!replaySteps.length && <p className="text-sm text-slate-400">Run a scenario to see per-frame ally bans/picks.</p>}
          <div className="max-h-56 space-y-2 overflow-auto">
            {replaySteps.map((step: { index: number; allyBans: string[]; allyPicks: string[]; selectedLane?: string }) => (
              <div key={step.index} className="rounded-lg border border-white/10 bg-black/20 p-2 text-xs">
                <div className="font-semibold text-slate-200">Frame {step.index}</div>
                <div className="mt-1 text-slate-400">Bans: {step.allyBans.join(", ") || "(none)"}</div>
                <div className="text-slate-400">Picks: {step.allyPicks.join(", ") || "(none)"}</div>
                {step.selectedLane && <div className="text-slate-400">Lane: {step.selectedLane}</div>}
              </div>
            ))}
          </div>
          {finalState && <div className="mt-3 rounded-lg border border-emerald-400/20 bg-emerald-500/10 p-3 text-sm">
            <div className="font-semibold text-emerald-100">Final ingested state</div>
            <div className="mt-1 text-emerald-50/80">Ally bans: {slotSummary(finalState.allyBans)}</div>
            <div className="text-emerald-50/80">Ally picks: {slotSummary(finalState.allyPicks)}</div>
            {finalState.selectedLane?.value && <div className="text-emerald-50/80">Lane: {finalState.selectedLane.value}</div>}
          </div>}
        </div>

        <div className="card p-4">
          <h3 className="mb-2 flex items-center gap-2 font-bold"><Smartphone className="h-4 w-4 text-cyan-300" />Reference capture</h3>
          {referenceFrame ? (
            <img
              src={draftSimulatorReferenceFrameUrl("last-adb")}
              alt="Last ADB draft frame"
              className="max-h-[280px] w-full rounded-lg border border-white/10 object-contain bg-black/40"
            />
          ) : (
            <p className="text-sm text-slate-400">No cached frame yet. Run Live Capture once while on the draft screen to save <code className="text-xs">last-adb-frame.png</code>.</p>
          )}
          <p className="mt-2 text-xs text-slate-500">Tune CV offline with <code className="text-xs">tools/analyze-draft-slots.mjs</code> on that file.</p>
        </div>
      </div>
    </div>

    <div className="card p-4">
      <h3 className="font-bold">ADB game asset library</h3>
      <p className="mt-1 text-sm text-slate-400">{assetHint}</p>
      <p className="mt-2 text-sm text-slate-400">
        Settings → Data Sync: <b>Index Draft Assets</b> (hero heads), <b>Index CV Surfaces</b> (draft/HUD/minimap bundles), <b>Download Full UI</b> (entire Unity UI library from the phone). Data lives under <code className="text-xs">data/adb-assets/</code> (gitignored).
      </p>
      <p className="mt-2 text-sm text-slate-500">
        A full in-game UI rebuild is a later phase; today we simulate <b>roster state</b> and <b>CV on real screenshots</b>, not a playable mock draft client.
      </p>
      <Link className="btn mt-3 inline-flex" to="/settings">Open Data Sync</Link>
    </div>

    {active?.expect && Object.keys(active.expect).length > 0 && (
      <details className="card p-4" open={replay.isSuccess}>
        <summary className="cursor-pointer font-bold">Expected outcome ({activeId})</summary>
        <pre className="mt-3 overflow-auto rounded-lg bg-black/30 p-3 text-xs text-slate-300">{JSON.stringify(active.expect, null, 2)}</pre>
      </details>
    )}
  </div>;
}
